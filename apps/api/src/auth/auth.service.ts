import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { UsersService } from '../users/users.service';
import type {
  AuthTokens,
  DemoLoginDto,
  KakaoAuthStatusDto,
  KakaoProfile,
  LoginResponseDto,
} from '@tripick/types';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  getKakaoAuthUrl(): string {
    const status = this.getKakaoStatus();
    if (!status.ready || !status.authorizeUrl) {
      throw new BadRequestException({
        message: 'Kakao OAuth is not configured yet',
        missingKeys: status.missingKeys,
      });
    }
    return status.authorizeUrl;
  }

  getKakaoStatus(): KakaoAuthStatusDto {
    const clientId = this.config.get<string>('KAKAO_REST_API_KEY');
    const redirectUri = this.config.get<string>('KAKAO_CALLBACK_URL');
    const missingKeys = [
      ...(clientId ? [] : ['KAKAO_REST_API_KEY']),
      ...(redirectUri ? [] : ['KAKAO_CALLBACK_URL']),
    ];
    if (missingKeys.length > 0 || !clientId || !redirectUri) {
      return { ready: false, missingKeys };
    }
    return {
      ready: true,
      authorizeUrl:
        `https://kauth.kakao.com/oauth/authorize` +
        `?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code`,
    };
  }

  async loginWithKakao(code: string): Promise<LoginResponseDto> {
    const kakaoToken = await this.getKakaoToken(code);
    const profile = await this.getKakaoProfile(kakaoToken);
    const user = await this.usersService.findOrCreateByKakao(profile);
    const tokens = await this.issueTokens(user.id);
    return {
      tokens,
      user: {
        id: user.id,
        nickname: user.nickname,
        ...(user.profileImageUrl ? { profileImageUrl: user.profileImageUrl } : {}),
      },
    };
  }

  async loginDemo(dto: DemoLoginDto = {}): Promise<LoginResponseDto> {
    const user = await this.usersService.findOrCreateDemoUser(
      dto.nickname?.trim() || '데모 여행자',
    );
    const tokens = await this.issueTokens(user.id);
    return {
      tokens,
      user: {
        id: user.id,
        nickname: user.nickname,
        ...(user.profileImageUrl ? { profileImageUrl: user.profileImageUrl } : {}),
      },
    };
  }

  async refreshTokens(refreshToken: string): Promise<AuthTokens> {
    try {
      const payload = this.jwtService.verify<{ sub: string }>(refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET') ?? 'tripick-demo-refresh-secret',
      });
      return this.issueTokens(payload.sub);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(_refreshToken: string): Promise<void> {
    return;
  }

  getWebKakaoSuccessUrl(session: LoginResponseDto): string {
    const url = new URL('/auth/kakao/callback', this.getWebAppUrl());
    const payload = Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
    url.hash = `session=${payload}`;
    return url.toString();
  }

  getWebKakaoErrorUrl(message: string): string {
    const url = new URL('/auth/kakao/callback', this.getWebAppUrl());
    url.searchParams.set('error', message);
    return url.toString();
  }

  private async issueTokens(userId: string): Promise<AuthTokens> {
    const payload = { sub: userId };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload),
      this.jwtService.signAsync(payload, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET') ?? 'tripick-demo-refresh-secret',
        expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN', '30d'),
      }),
    ]);
    return { accessToken, refreshToken };
  }

  private async getKakaoToken(code: string): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.config.getOrThrow('KAKAO_REST_API_KEY'),
      redirect_uri: this.config.getOrThrow('KAKAO_CALLBACK_URL'),
      code,
    });
    const clientSecret = this.config.get<string>('KAKAO_CLIENT_SECRET');
    if (clientSecret) {
      body.set('client_secret', clientSecret);
    }

    const res = await axios.post<{ access_token: string }>(
      'https://kauth.kakao.com/oauth/token',
      body,
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
      ...(account?.profile?.profile_image_url
        ? { profileImageUrl: account.profile.profile_image_url }
        : {}),
      ...(account?.email ? { email: account.email } : {}),
    };
  }

  private getWebAppUrl(): string {
    return this.config.get<string>('WEB_APP_URL') ?? 'http://localhost:3000';
  }
}
