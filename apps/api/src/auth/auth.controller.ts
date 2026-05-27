import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Body,
  Query,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { AuthService } from './auth.service';
import type { DemoLoginDto } from '@tripick/types';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
    @Res({ passthrough: true }) res: Response,
  ) {
    const wantsJson = format === 'json';
    if (!code) {
      const message = '카카오 인증 코드가 없습니다.';
      if (wantsJson) {
        throw new BadRequestException(message);
      }
      res.redirect(this.authService.getWebKakaoErrorUrl(message));
      return undefined;
    }

    try {
      const session = await this.authService.loginWithKakao(code);
      if (wantsJson) {
        return session;
      }
      res.redirect(this.authService.getWebKakaoSuccessUrl(session));
      return undefined;
    } catch (error) {
      if (wantsJson) {
        throw error;
      }
      res.redirect(
        this.authService.getWebKakaoErrorUrl(
          error instanceof Error ? error.message : '카카오 로그인을 완료하지 못했습니다.',
        ),
      );
      return undefined;
    }
  }

  @Post('demo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '데모 세션 발급' })
  loginDemo(@Body() dto: DemoLoginDto) {
    return this.authService.loginDemo(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '액세스 토큰 갱신' })
  async refresh(@Body('refreshToken') refreshToken: string) {
    return this.authService.refreshTokens(refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '로그아웃' })
  async logout(@Body('refreshToken') refreshToken: string) {
    await this.authService.logout(refreshToken);
  }
}
