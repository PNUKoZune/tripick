import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { KakaoExchangeResultDto, LoginResponseDto } from '@tripick/types';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { timingSafeEqual } from 'node:crypto';
import type { CookieOptions, Request, Response } from 'express';
import { perMinute } from '../common/throttle';
import { UserEntity } from '../users/user.entity';
import { AuthService, normalizeKakaoReturnTarget, type TokenContext } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { KakaoExchangeService } from './kakao-exchange.service';
import { EmailSendLimiterService, type MailPurpose } from './email-send-limiter.service';
import {
  ChangePasswordBodyDto,
  EmailLoginBodyDto,
  EmailSignupBodyDto,
  KakaoExchangeBodyDto,
  LogoutBodyDto,
  RefreshTokenBodyDto,
  RequestPasswordResetBodyDto,
  ResendVerificationBodyDto,
  ResetPasswordBodyDto,
  VerifyEmailBodyDto,
} from './dto/auth.dto';

/** 카카오 로그인 CSRF 방어용 state 를 담는 쿠키. 로그인 시작 → 콜백 한 왕복만 산다. */
const KAKAO_STATE_COOKIE = 'tripick_kakao_state';
const KAKAO_RETURN_COOKIE = 'tripick_kakao_return';
/**
 * 로그인을 시작한 브라우저가 보낸 bind 비밀. 콜백에서 교환 코드에 옮겨 실어(해시로),
 * 그 브라우저만 코드를 세션으로 바꿀 수 있게 한다.
 *
 * state 와 별개인 이유: state 는 카카오 왕복(시작↔콜백)을 지키고 콜백에서 소비되는데,
 * 막아야 하는 마지막 홉은 그 뒤의 `POST /auth/kakao/exchange` 다. 교환은 웹 프록시를 거쳐
 * 오리진이 갈리므로 쿠키가 안 실린다 — 그래서 브라우저 쪽 보관은 웹이 맡고(localStorage),
 * 서버는 시작 때 받은 값을 이 쿠키로 콜백까지만 들고 간다.
 */
const KAKAO_BIND_COOKIE = 'tripick_kakao_bind';
const KAKAO_STATE_TTL_MS = 10 * 60 * 1000;

/** 웹이 생성하는 bind 비밀(32바이트 base64url = 43자)을 받아들일 범위. */
const KAKAO_BIND_MIN_LENGTH = 32;
const KAKAO_BIND_MAX_LENGTH = 256;

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly kakaoExchange: KakaoExchangeService,
    private readonly mailLimiter: EmailSendLimiterService,
    private readonly config: ConfigService,
  ) {}

  // ─── 이메일 가입 / 인증 / 로그인 / 재설정 ────────────────────

  @Post('signup')
  @HttpCode(HttpStatus.OK)
  @Throttle(perMinute(5)) // 계정 생성 + 메일 발송 남용 방지
  @ApiOperation({ summary: '이메일 회원가입 (인증 메일 발송)' })
  async signup(@Body() dto: EmailSignupBodyDto, @Res({ passthrough: true }) res: Response) {
    // 가입도 메일을 보내는 경로다 — 미인증 계정이면 인증 메일 재발송, 인증된 계정이면
    // "가입 시도" 안내가 나간다. 여기에 주소별 한도가 없으면 재발송 라우트의 한도를
    // 가입으로 그냥 우회할 수 있고, 남의 주소로 메일을 무제한 꽂을 수 있다.
    // 버킷을 재발송과 **공유**해야(purpose='verify') 우회가 막힌다.
    await this.assertMailQuota(dto.email, 'verify', res);
    return this.authService.signupWithEmail(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(perMinute(10)) // 비밀번호 브루트포스 방지
  @ApiOperation({ summary: '이메일 + 비밀번호 로그인' })
  login(@Body() dto: EmailLoginBodyDto, @Req() req: Request) {
    return this.authService.loginWithEmail(dto, this.tokenContext(req));
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @Throttle(perMinute(20)) // 인증 토큰 추측 방지
  @ApiOperation({ summary: '이메일 인증 토큰 검증' })
  verifyEmail(@Body() dto: VerifyEmailBodyDto) {
    return this.authService.verifyEmail(dto.token);
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @Throttle(perMinute(3)) // 메일 발송 남용 방지
  @ApiOperation({ summary: '이메일 인증 메일 재발송' })
  async resendVerification(
    @Body() dto: ResendVerificationBodyDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.assertMailQuota(dto.email, 'verify', res);
    return this.authService.resendVerification(dto.email);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle(perMinute(3)) // 메일 발송 남용 방지
  @ApiOperation({ summary: '비밀번호 재설정 메일 발송' })
  async forgotPassword(
    @Body() dto: RequestPasswordResetBodyDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.assertMailQuota(dto.email, 'reset', res);
    return this.authService.requestPasswordReset(dto.email);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle(perMinute(10)) // 재설정 토큰 추측 방지
  @ApiOperation({ summary: '비밀번호 재설정 토큰 검증 + 새 비밀번호 저장' })
  resetPassword(@Body() dto: ResetPasswordBodyDto) {
    return this.authService.resetPassword(dto.token, dto.password);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @Throttle(perMinute(5)) // 현재 비밀번호 추측 방지
  @ApiOperation({ summary: '로그인 상태에서 비밀번호 변경 (현재 비밀번호 확인)' })
  changePassword(
    @CurrentUser() user: UserEntity,
    @Body() dto: ChangePasswordBodyDto,
    @Req() req: Request,
  ): Promise<LoginResponseDto> {
    // 새 세션을 돌려준다 — 서비스가 다른 기기의 refresh 를 전부 끊기 때문에, 방금 바꾼
    // 이 기기까지 같이 죽지 않으려면 여기서 발급한 토큰으로 갈아타야 한다.
    return this.authService.changePassword(user.id, dto, this.tokenContext(req));
  }

  // ─── 카카오 OAuth ──────────────────────────────────────────

  @Get('kakao')
  @ApiOperation({ summary: '카카오 OAuth 로그인 리디렉트' })
  kakaoLogin(
    @Query('returnTo') returnTo: string | undefined,
    @Query('bind') bind: string | undefined,
    @Res() res: Response,
  ) {
    // bind 가 없으면 어차피 교환에서 막힌다 — 카카오 동의까지 걷게 하지 말고 여기서 끊는다.
    // (구버전 웹 번들이 배포 순서 때문에 잠깐 이 경로로 올 수 있다)
    const target = normalizeKakaoReturnTarget(returnTo);
    if (!isAcceptableBind(bind)) {
      const message = '로그인 요청이 올바르지 않습니다. 페이지를 새로고침한 뒤 다시 시도해주세요.';
      // 앱에서 시작했으면 브라우저에 안내를 가두지 말고 앱으로 돌려보낸다.
      res.redirect(this.authService.getKakaoErrorUrl(message, target));
      return;
    }
    const { authorizeUrl, state } = this.authService.startKakaoAuth();
    // state 를 브라우저에 묶어 둔다. httpOnly 라 스크립트가 못 읽고, SameSite=Lax 여도
    // 카카오에서 돌아오는 건 top-level GET 이라 콜백에 정상적으로 실려 온다.
    res.cookie(KAKAO_STATE_COOKIE, state, this.stateCookieOptions());
    res.cookie(KAKAO_BIND_COOKIE, bind, this.stateCookieOptions());
    if (target === 'web') {
      res.clearCookie(KAKAO_RETURN_COOKIE, this.stateCookieOptions());
    } else {
      res.cookie(KAKAO_RETURN_COOKIE, target, this.stateCookieOptions());
    }
    res.redirect(authorizeUrl);
  }

  @Get('kakao/status')
  @ApiOperation({ summary: '카카오 OAuth 설정 상태 조회' })
  kakaoStatus() {
    return this.authService.getKakaoStatus();
  }

  @Get('kakao/callback')
  @ApiOperation({ summary: '카카오 OAuth 콜백' })
  async kakaoCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('format') format: 'json' | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const wantsJson = format === 'json';
    // state 는 한 번 쓰고 버린다 — 성공이든 실패든 먼저 지워 재사용을 막는다.
    const expectedState = readCookie(req, KAKAO_STATE_COOKIE);
    const bindSecret = readCookie(req, KAKAO_BIND_COOKIE);
    const target = normalizeKakaoReturnTarget(readCookie(req, KAKAO_RETURN_COOKIE));
    res.clearCookie(KAKAO_STATE_COOKIE, this.stateCookieOptions());
    res.clearCookie(KAKAO_BIND_COOKIE, this.stateCookieOptions());
    res.clearCookie(KAKAO_RETURN_COOKIE, this.stateCookieOptions());

    if (!code) {
      const message = '카카오 인증 코드가 없습니다.';
      if (wantsJson) throw new BadRequestException(message);
      res.redirect(this.authService.getKakaoErrorUrl(message, target));
      return undefined;
    }
    // 이 브라우저가 시작하지 않은 콜백 — 공격자 인가 코드로 남의 계정에 로그인시키는 CSRF.
    if (!matchesState(expectedState, state)) {
      const message = '로그인 요청이 만료됐거나 유효하지 않습니다. 다시 시도해주세요.';
      if (wantsJson) throw new BadRequestException(message);
      res.redirect(this.authService.getKakaoErrorUrl(message, target));
      return undefined;
    }

    // 교환 코드를 발급할 수 없는 상태(bind 소실)에서 로그인을 진행하면 코드만 떠돌게 된다.
    // `format=json` 은 세션을 요청자에게 바로 돌려주므로(코드 없음) bind 가 필요 없다.
    const boundSecret = bindSecret ?? '';
    if (!wantsJson && !isAcceptableBind(boundSecret)) {
      const message = '로그인 요청이 만료됐거나 유효하지 않습니다. 다시 시도해주세요.';
      res.redirect(this.authService.getKakaoErrorUrl(message, target));
      return undefined;
    }

    try {
      const resolved = await this.authService.resolveKakaoLogin(code, this.tokenContext(req));
      if (wantsJson) {
        // 브라우저가 아닌 디버그 경로라 동의 화면을 띄울 데가 없다 — 여기서는 예전처럼
        // 곧바로 계정을 만들어 세션을 돌려준다. 사람이 타는 가입 경로가 아니다.
        return resolved.kind === 'session'
          ? resolved.session
          : await this.authService.completeKakaoSignup(resolved.profile, this.tokenContext(req));
      }
      // 신규 가입자는 계정 대신 대기표만 발급한다. 동의 화면에서 `POST /auth/kakao/signup`
      // 으로 돌아와야 계정이 생긴다. URL 모양은 기존과 같아서(코드 하나) 웹은 교환 응답으로
      // 둘을 구분한다.
      const exchangeCode =
        resolved.kind === 'session'
          ? await this.kakaoExchange.issue(resolved.session, boundSecret)
          : await this.kakaoExchange.issueSignupTicket(resolved.profile, boundSecret);
      res.redirect(this.authService.getKakaoSuccessUrl(exchangeCode, target));
      return undefined;
    } catch (error) {
      if (wantsJson) throw error;
      const message =
        error instanceof Error ? error.message : '카카오 로그인을 완료하지 못했습니다.';
      res.redirect(this.authService.getKakaoErrorUrl(message, target));
      return undefined;
    }
  }

  @Post('kakao/exchange')
  @HttpCode(HttpStatus.OK)
  @Throttle(perMinute(20))
  @ApiOperation({ summary: '카카오 콜백 1회용 코드 → 세션 또는 약관 동의 요구' })
  async kakaoExchangeCode(@Body() dto: KakaoExchangeBodyDto): Promise<KakaoExchangeResultDto> {
    // 코드가 어느 통에 들어 있는지로 기존 회원/신규 가입자가 갈린다. 세션 통을 먼저 보고,
    // 없으면 가입 대기표를 본다 — 둘 다 없으면 대기표 쪽 만료 메시지가 나간다.
    try {
      return { status: 'ok', session: await this.kakaoExchange.consume(dto.code, dto.bind) };
    } catch (error) {
      if (!(error instanceof UnauthorizedException)) throw error;
      const profile = await this.kakaoExchange.consumeSignupTicket(dto.code, dto.bind);
      // 동의 화면이 되돌려줄 코드를 새로 끊는다(방금 소비했으므로). 이 코드가 곧 "이 사람은
      // 카카오 인증을 통과했다"는 증거라 bind 는 같은 브라우저 것으로 다시 묶인다.
      const consentCode = await this.kakaoExchange.issueSignupTicket(profile, dto.bind);
      return {
        status: 'consent_required',
        consentCode,
        ...(profile.nickname ? { nickname: profile.nickname } : {}),
        ...(profile.email ? { email: profile.email } : {}),
      };
    }
  }

  @Post('kakao/signup')
  @HttpCode(HttpStatus.OK)
  @Throttle(perMinute(10))
  @ApiOperation({ summary: '약관 동의 후 카카오 신규 가입 완료' })
  async kakaoSignup(
    @Body() dto: KakaoExchangeBodyDto,
    @Req() req: Request,
  ): Promise<LoginResponseDto> {
    const profile = await this.kakaoExchange.consumeSignupTicket(dto.code, dto.bind);
    return this.authService.completeKakaoSignup(profile, this.tokenContext(req));
  }

  // ─── 토큰 ──────────────────────────────────────────────────

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '액세스 토큰 갱신 (refresh rotation)' })
  refresh(@Body() dto: RefreshTokenBodyDto, @Req() req: Request) {
    return this.authService.refreshTokens(dto.refreshToken, this.tokenContext(req));
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '로그아웃 (refresh token 폐기)' })
  async logout(@Body() dto: LogoutBodyDto) {
    await this.authService.logout(dto.refreshToken ?? '');
  }

  /**
   * 수신 주소 기준 메일 한도. 라우트의 `@Throttle` 은 IP 기준이라 IP 를 갈아 가며
   * 같은 주소로 메일을 몰 수 있어, 주소별로 한 번 더 센다.
   */
  private async assertMailQuota(email: string, purpose: MailPurpose, res: Response): Promise<void> {
    const { allowed, retryAfter } = await this.mailLimiter.consume(email, purpose);
    if (allowed) return;
    res.setHeader('Retry-After', String(retryAfter));
    throw new HttpException(
      '이 주소로 메일을 너무 많이 보냈어요. 잠시 후 다시 시도해주세요.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /** 콜백(`/api/v1/auth/kakao/callback`)에만 실리도록 경로를 좁힌다. */
  private stateCookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get<string>('NODE_ENV') === 'production',
      path: '/api/v1/auth',
      maxAge: KAKAO_STATE_TTL_MS,
    };
  }

  private tokenContext(req: Request): TokenContext {
    const forwarded = (req.headers['x-forwarded-for'] ?? '') as string;
    const ip = forwarded.split(',')[0]?.trim() || req.ip || undefined;
    const ua = (req.headers['user-agent'] ?? '') as string;
    const ctx: TokenContext = {};
    if (ua) ctx.userAgent = ua.slice(0, 255);
    if (ip) ctx.ipAddress = ip.slice(0, 64);
    return ctx;
  }
}

/** cookie-parser 없이 쓰는 최소 리더 — 이 컨트롤러가 읽는 쿠키는 state 하나뿐이다. */
function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== name) continue;
    return decodeURIComponent(part.slice(index + 1).trim());
  }
  return undefined;
}

/**
 * bind 비밀로 받아들일 형태인지. 길이 하한이 곧 추측 저항이라 짧은 값은 거부한다 —
 * 클라이언트가 정하는 값이므로 "보냈다"만 확인하면 `bind=1` 로도 통과한다.
 */
function isAcceptableBind(value: string | undefined): value is string {
  const bind = (value ?? '').trim();
  if (bind.length < KAKAO_BIND_MIN_LENGTH || bind.length > KAKAO_BIND_MAX_LENGTH) return false;
  return /^[A-Za-z0-9_-]+$/.test(bind);
}

function matchesState(expected: string | undefined, received: string | undefined): boolean {
  if (!expected || !received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}
