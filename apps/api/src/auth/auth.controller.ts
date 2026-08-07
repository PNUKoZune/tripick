import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { timingSafeEqual } from 'node:crypto';
import type { CookieOptions, Request, Response } from 'express';
import { AuthService, type TokenContext } from './auth.service';

/** 분당 요청 제한 헬퍼 (ttl 단위 ms) */
const perMinute = (limit: number) => ({ default: { limit, ttl: 60_000 } });

/** 카카오 로그인 CSRF 방어용 state 를 담는 쿠키. 로그인 시작 → 콜백 한 왕복만 산다. */
const KAKAO_STATE_COOKIE = 'tripick_kakao_state';
const KAKAO_STATE_TTL_MS = 10 * 60 * 1000;
import type {
  EmailLoginDto,
  EmailSignupDto,
  RequestPasswordResetDto,
  ResendVerificationDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from '@tripick/types';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  // ─── 이메일 가입 / 인증 / 로그인 / 재설정 ────────────────────

  @Post('signup')
  @HttpCode(HttpStatus.OK)
  @Throttle(perMinute(5)) // 계정 생성 + 메일 발송 남용 방지
  @ApiOperation({ summary: '이메일 회원가입 (인증 메일 발송)' })
  signup(@Body() dto: EmailSignupDto) {
    return this.authService.signupWithEmail(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(perMinute(10)) // 비밀번호 브루트포스 방지
  @ApiOperation({ summary: '이메일 + 비밀번호 로그인' })
  login(@Body() dto: EmailLoginDto, @Req() req: Request) {
    return this.authService.loginWithEmail(dto, this.tokenContext(req));
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @Throttle(perMinute(20)) // 인증 토큰 추측 방지
  @ApiOperation({ summary: '이메일 인증 토큰 검증' })
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto?.token ?? '');
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @Throttle(perMinute(3)) // 메일 발송 남용 방지
  @ApiOperation({ summary: '이메일 인증 메일 재발송' })
  resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerification(dto?.email ?? '');
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle(perMinute(3)) // 메일 발송 남용 방지
  @ApiOperation({ summary: '비밀번호 재설정 메일 발송' })
  forgotPassword(@Body() dto: RequestPasswordResetDto) {
    return this.authService.requestPasswordReset(dto?.email ?? '');
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle(perMinute(10)) // 재설정 토큰 추측 방지
  @ApiOperation({ summary: '비밀번호 재설정 토큰 검증 + 새 비밀번호 저장' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto?.token ?? '', dto?.password ?? '');
  }

  // ─── 카카오 OAuth ──────────────────────────────────────────

  @Get('kakao')
  @ApiOperation({ summary: '카카오 OAuth 로그인 리디렉트' })
  kakaoLogin(@Res() res: Response) {
    const { authorizeUrl, state } = this.authService.startKakaoAuth();
    // state 를 브라우저에 묶어 둔다. httpOnly 라 스크립트가 못 읽고, SameSite=Lax 여도
    // 카카오에서 돌아오는 건 top-level GET 이라 콜백에 정상적으로 실려 온다.
    res.cookie(KAKAO_STATE_COOKIE, state, this.stateCookieOptions());
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
    res.clearCookie(KAKAO_STATE_COOKIE, this.stateCookieOptions());

    if (!code) {
      const message = '카카오 인증 코드가 없습니다.';
      if (wantsJson) throw new BadRequestException(message);
      res.redirect(this.authService.getWebKakaoErrorUrl(message));
      return undefined;
    }
    // 이 브라우저가 시작하지 않은 콜백 — 공격자 인가 코드로 남의 계정에 로그인시키는 CSRF.
    if (!matchesState(expectedState, state)) {
      const message = '로그인 요청이 만료됐거나 유효하지 않습니다. 다시 시도해주세요.';
      if (wantsJson) throw new BadRequestException(message);
      res.redirect(this.authService.getWebKakaoErrorUrl(message));
      return undefined;
    }

    try {
      const session = await this.authService.loginWithKakao(code, this.tokenContext(req));
      if (wantsJson) return session;
      res.redirect(this.authService.getWebKakaoSuccessUrl(session));
      return undefined;
    } catch (error) {
      if (wantsJson) throw error;
      res.redirect(
        this.authService.getWebKakaoErrorUrl(
          error instanceof Error ? error.message : '카카오 로그인을 완료하지 못했습니다.',
        ),
      );
      return undefined;
    }
  }

  // ─── 토큰 ──────────────────────────────────────────────────

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '액세스 토큰 갱신 (refresh rotation)' })
  refresh(@Body('refreshToken') refreshToken: string, @Req() req: Request) {
    return this.authService.refreshTokens(refreshToken, this.tokenContext(req));
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '로그아웃 (refresh token 폐기)' })
  async logout(@Body('refreshToken') refreshToken: string) {
    await this.authService.logout(refreshToken);
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

function matchesState(expected: string | undefined, received: string | undefined): boolean {
  if (!expected || !received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}
