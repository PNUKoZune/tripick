import { Controller, Get, Post, Body, Query, Res, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { AuthService } from './auth.service';

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

  @Get('kakao/callback')
  @ApiOperation({ summary: '카카오 OAuth 콜백' })
  async kakaoCallback(@Query('code') code: string) {
    return this.authService.loginWithKakao(code);
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
