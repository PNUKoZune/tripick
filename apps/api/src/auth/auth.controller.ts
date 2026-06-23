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
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService, type TokenContext } from './auth.service';

/** 분당 요청 제한 헬퍼 (ttl 단위 ms) */
const perMinute = (limit: number) => ({ default: { limit, ttl: 60_000 } });
import type {
  DemoLoginDto,
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
  constructor(private readonly authService: AuthService) {}

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
    const kakaoAuthUrl = this.authService.getKakaoAuthUrl();
    res.redirect(kakaoAuthUrl);
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
    @Query('format') format: 'json' | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const wantsJson = format === 'json';
    if (!code) {
      const message = '카카오 인증 코드가 없습니다.';
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

  // ─── 데모 / 토큰 ───────────────────────────────────────────

  @Post('demo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '개발용 세션 발급' })
  loginDemo(@Body() dto: DemoLoginDto, @Req() req: Request) {
    return this.authService.loginDemo(dto, this.tokenContext(req));
  }

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
