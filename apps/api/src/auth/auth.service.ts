import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { UsersService } from '../users/users.service';
import type { AuthTokens, KakaoProfile } from '@tripick/types';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  getKakaoAuthUrl(): string {
    const clientId = this.config.getOrThrow<string>('KAKAO_REST_API_KEY');
    const redirectUri = this.config.getOrThrow<string>('KAKAO_CALLBACK_URL');
    return (
      `https://kauth.kakao.com/oauth/authorize` +
      `?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code`
    );
  }

  async loginWithKakao(code: string) {
    const kakaoToken = await this.getKakaoToken(code);
    const profile = await this.getKakaoProfile(kakaoToken);
    const user = await this.usersService.findOrCreateByKakao(profile);
    const tokens = await this.issueTokens(user.id);
    return { tokens, user };
  }

  async refreshTokens(refreshToken: string): Promise<AuthTokens> {
    try {
      const payload = this.jwtService.verify<{ sub: string }>(refreshToken, {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
      });
      return this.issueTokens(payload.sub);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(_refreshToken: string): Promise<void> {
    // TODO: Redis에 refresh token 블랙리스트 추가
  }

  private async issueTokens(userId: string): Promise<AuthTokens> {
    const payload = { sub: userId };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload),
      this.jwtService.signAsync(payload, {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN', '30d'),
      }),
    ]);
    return { accessToken, refreshToken };
  }

  private async getKakaoToken(code: string): Promise<string> {
    const res = await axios.post<{ access_token: string }>(
      'https://kauth.kakao.com/oauth/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: this.config.getOrThrow('KAKAO_REST_API_KEY'),
        redirect_uri: this.config.getOrThrow('KAKAO_CALLBACK_URL'),
        code,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    return res.data.access_token;
  }

  private async getKakaoProfile(accessToken: string): Promise<KakaoProfile> {
    const res = await axios.get<{
      id: number;
      kakao_account?: {
        email?: string;
        profile?: { nickname?: string; profile_image_url?: string };
      };
    }>('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const account = res.data.kakao_account;
    return {
      id: String(res.data.id),
      nickname: account?.profile?.nickname ?? '여행자',
      profileImageUrl: account?.profile?.profile_image_url,
      email: account?.email,
    };
  }
}
