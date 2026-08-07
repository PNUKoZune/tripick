import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import axios, { type AxiosError } from 'axios';

import { UsersService } from '../users/users.service';
import { UserEntity } from '../users/user.entity';
import { EmailService } from '../email/email.service';
import { refreshTokenSecret } from '../common/jwt-secrets';
import { EmailTokenEntity, type EmailTokenPurpose } from './entities/email-token.entity';
import { RefreshTokenEntity } from './entities/refresh-token.entity';
import type {
  AuthOpResultDto,
  AuthTokens,
  EmailLoginDto,
  EmailSignupDto,
  KakaoAuthStatusDto,
  KakaoProfile,
  LoginResponseDto,
  SessionUserDto,
} from '@tripick/types';

const BCRYPT_COST = 12;
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface TokenContext {
  userAgent?: string;
  ipAddress?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  /** 부팅 시점에 확정한다 — 키가 없거나 공개 값이면 프로덕션에서 여기서 죽는다. */
  private readonly refreshSecret: string;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly emailService: EmailService,
    @InjectRepository(RefreshTokenEntity)
    private readonly refreshRepo: Repository<RefreshTokenEntity>,
    @InjectRepository(EmailTokenEntity)
    private readonly emailTokenRepo: Repository<EmailTokenEntity>,
  ) {
    this.refreshSecret = refreshTokenSecret(this.config);
  }

  // ─────────────────────────────────────────────────────────────
  // Email signup / login / verification / reset
  // ─────────────────────────────────────────────────────────────

  async signupWithEmail(dto: EmailSignupDto): Promise<AuthOpResultDto> {
    const email = normalizeEmail(dto.email);
    const nickname = (dto.nickname ?? '').trim();
    assertValidEmail(email);
    assertValidPassword(dto.password);
    if (!nickname) throw new BadRequestException('닉네임을 입력해주세요.');
    if (nickname.length > 20) throw new BadRequestException('닉네임은 20자 이내로 입력해주세요.');

    const existing = await this.usersService.findByEmail(email);
    if (existing) {
      // 이미 있는 계정에는 절대 비밀번호를 심지 않는다. 예전에는 pending 으로 받아 두고
      // 인증 링크로 승격했는데, 그 링크는 **계정 주인**에게 간다 — 주인이 "가입 인증"
      // 메일로 알고 누르는 순간 공격자가 넣은 비밀번호가 활성화돼 계정이 넘어갔다.
      // 대신 주인에게 상황만 알리고, 비밀번호 설정은 재설정 플로우로 보낸다.
      await this.emailService.sendAccountExistsNotice(email, {
        hasPassword: Boolean(existing.passwordHash),
        resetUrl: `${this.getWebAppUrl()}/forgot-password`,
        loginUrl: `${this.getWebAppUrl()}/login`,
      });
    } else {
      const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);
      const user = await this.usersService.createEmailUser({ email, passwordHash, nickname });
      await this.dispatchVerification(user);
    }

    // 두 갈래가 완전히 같은 응답을 낸다 — 다르면 그 자체로 가입 여부 조회 API 가 된다.
    return {
      ok: true,
      message: '인증 메일을 보냈어요. 메일을 확인해 가입을 완료해주세요.',
      email,
    };
  }

  async loginWithEmail(dto: EmailLoginDto, ctx: TokenContext = {}): Promise<LoginResponseDto> {
    const email = normalizeEmail(dto.email);
    if (!email || !dto.password) {
      throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않아요.');
    }
    const user = await this.usersService.findByEmail(email);
    if (!user || !user.passwordHash) {
      // 비밀번호가 아직 pending(인증 전)인 사용자는 인증을 안내한다.
      // 403 으로 던져야 클라이언트가 메시지를 그대로 노출(401 은 만료 안내로 치환됨).
      if (user?.pendingPasswordHash && (await bcrypt.compare(dto.password, user.pendingPasswordHash))) {
        throw new ForbiddenException('이메일 인증을 완료해야 로그인할 수 있어요. 메일함을 확인해주세요.');
      }
      throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않아요.');
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않아요.');
    }
    const tokens = await this.issueTokens(user.id, ctx);
    return { tokens, user: this.toSessionUser(user) };
  }

  async verifyEmail(rawToken: string): Promise<AuthOpResultDto> {
    const token = (rawToken ?? '').trim();
    if (!token) throw new BadRequestException('인증 토큰이 없어요.');

    const record = await this.consumeEmailToken(token, 'verify_email');
    const user = await this.usersService.findById(record.userId);
    if (!user) throw new NotFoundException('사용자를 찾을 수 없어요.');
    // markEmailVerified 가 인증 처리 + pending 비밀번호 승격을 함께 수행한다.
    // (이미 인증된 카카오 계정에 비밀번호를 연동한 경우도 여기서 활성화됨)
    await this.usersService.markEmailVerified(user.id);
    return { ok: true, message: '이메일 인증이 완료됐어요.' };
  }

  async resendVerification(rawEmail: string): Promise<AuthOpResultDto> {
    const email = normalizeEmail(rawEmail);
    if (!email) throw new BadRequestException('이메일을 입력해주세요.');
    const user = await this.usersService.findByEmail(email);
    // 사용자 enumeration 방지: 같은 응답 반환
    if (user && !user.emailVerifiedAt) {
      await this.dispatchVerification(user);
    }
    return { ok: true, message: '인증 메일을 재발송했어요. 메일함을 확인해주세요.', email };
  }

  async requestPasswordReset(rawEmail: string): Promise<AuthOpResultDto> {
    const email = normalizeEmail(rawEmail);
    if (!email) throw new BadRequestException('이메일을 입력해주세요.');
    const user = await this.usersService.findByEmail(email);
    // 사용자 enumeration 방지: 같은 응답 반환.
    // 비밀번호가 아직 없는 계정(카카오 단독 가입)도 통과시킨다 — 기존 계정에 비밀번호를
    // 다는 유일한 경로라, 여기서 막으면 카카오 가입자는 이메일 로그인을 영영 못 쓴다.
    if (user) {
      await this.dispatchPasswordReset(user);
    }
    return {
      ok: true,
      message: '메일이 전송됐어요. 메일함을 확인해 비밀번호를 재설정해주세요.',
      email,
    };
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<AuthOpResultDto> {
    const token = (rawToken ?? '').trim();
    if (!token) throw new BadRequestException('토큰이 없어요.');
    assertValidPassword(newPassword);

    const record = await this.consumeEmailToken(token, 'reset_password');
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    await this.usersService.setPassword(record.userId, passwordHash);
    // 비밀번호 변경 = 다른 디바이스 모두 로그아웃
    await this.revokeAllRefreshTokens(record.userId);
    return { ok: true, message: '비밀번호가 변경됐어요. 새 비밀번호로 로그인해주세요.' };
  }

  // ─────────────────────────────────────────────────────────────
  // Kakao / demo (기존 동작 유지 + session user 형식 통일)
  // ─────────────────────────────────────────────────────────────

  /**
   * 로그인 시작 — authorize URL + 그에 묶인 state 를 만든다.
   *
   * state 는 로그인 CSRF 방어다. 이게 없으면 공격자가 자기 인가 코드로 피해자 브라우저를
   * 콜백에 태워 **피해자를 공격자 계정으로 로그인**시킬 수 있고, 이후 피해자가 만드는 여행·
   * 업로드 사진이 전부 공격자 계정에 쌓인다. 컨트롤러가 같은 값을 httpOnly 쿠키로 심어
   * 브라우저에 묶고, 콜백에서 쿼리 state 와 대조한다 — URL 에만 실으면 아무 의미가 없다.
   */
  startKakaoAuth(): { authorizeUrl: string; state: string } {
    const { clientId, redirectUri } = this.requireKakaoConfig();
    const state = generateRandomToken(16);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state,
    });
    return {
      authorizeUrl: `https://kauth.kakao.com/oauth/authorize?${params.toString()}`,
      state,
    };
  }

  getKakaoStatus(): KakaoAuthStatusDto {
    const missingKeys = this.missingKakaoKeys();
    return missingKeys.length > 0 ? { ready: false, missingKeys } : { ready: true };
  }

  private missingKakaoKeys(): string[] {
    return [
      ...(this.config.get<string>('KAKAO_REST_API_KEY') ? [] : ['KAKAO_REST_API_KEY']),
      ...(this.config.get<string>('KAKAO_CALLBACK_URL') ? [] : ['KAKAO_CALLBACK_URL']),
    ];
  }

  private requireKakaoConfig(): { clientId: string; redirectUri: string } {
    const clientId = this.config.get<string>('KAKAO_REST_API_KEY');
    const redirectUri = this.config.get<string>('KAKAO_CALLBACK_URL');
    if (!clientId || !redirectUri) {
      throw new BadRequestException({
        message: 'Kakao OAuth is not configured yet',
        missingKeys: this.missingKakaoKeys(),
      });
    }
    return { clientId, redirectUri };
  }

  async loginWithKakao(code: string, ctx: TokenContext = {}): Promise<LoginResponseDto> {
    const kakaoToken = await this.getKakaoToken(code);
    const profile = await this.getKakaoProfile(kakaoToken);
    const user = await this.usersService.findOrCreateByKakao(profile);
    const tokens = await this.issueTokens(user.id, ctx);
    return { tokens, user: this.toSessionUser(user) };
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

  // ─────────────────────────────────────────────────────────────
  // Refresh rotation + logout
  // ─────────────────────────────────────────────────────────────

  /** 새 access/refresh 발급. refresh 는 hash 저장. familyId = 첫 발급 시 자기 자신. */
  private async issueTokens(
    userId: string,
    ctx: TokenContext = {},
    familyId?: string,
  ): Promise<AuthTokens> {
    const payload = { sub: userId };
    const accessToken = await this.jwtService.signAsync(payload);
    const refreshToken = await this.jwtService.signAsync(payload, {
      secret: this.refreshSecret,
      expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN', '30d'),
    });

    const tokenHash = sha256(refreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    const row = await this.refreshRepo.save(
      this.refreshRepo.create({
        userId,
        tokenHash,
        familyId: familyId ?? '__pending__',
        expiresAt,
        userAgent: ctx.userAgent ?? null,
        ipAddress: ctx.ipAddress ?? null,
      } as Partial<RefreshTokenEntity>),
    );
    if (!familyId) {
      row.familyId = row.id;
      await this.refreshRepo.save(row);
    }

    return { accessToken, refreshToken };
  }

  async refreshTokens(refreshToken: string, ctx: TokenContext = {}): Promise<AuthTokens> {
    if (!refreshToken) throw new UnauthorizedException('Invalid refresh token');
    let payload: { sub: string };
    try {
      payload = this.jwtService.verify<{ sub: string }>(refreshToken, {
        secret: this.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokenHash = sha256(refreshToken);
    const row = await this.refreshRepo.findOne({ where: { tokenHash } });
    if (!row) {
      // JWT 는 유효하지만 DB 에 없음 — 폐기됐거나 위조. 안전하게 family 전체 폐기.
      await this.revokeAllRefreshTokens(payload.sub);
      throw new UnauthorizedException('Refresh token revoked');
    }
    if (row.revokedAt) {
      throw new UnauthorizedException('Refresh token revoked');
    }
    if (row.replacedAt) {
      // reuse detection — 이미 rotate 된 토큰을 또 쓰려고 함. 탈취 의심.
      this.logger.warn(
        `Refresh token reuse detected for user=${row.userId} family=${row.familyId}`,
      );
      await this.revokeFamily(row.familyId);
      throw new UnauthorizedException('Refresh token reused');
    }
    if (row.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    // rotation: 같은 family 로 새 토큰 발급
    const tokens = await this.issueTokens(row.userId, ctx, row.familyId);
    row.replacedAt = new Date();
    await this.refreshRepo.save(row);
    return tokens;
  }

  async logout(refreshToken: string): Promise<void> {
    if (!refreshToken) return;
    const tokenHash = sha256(refreshToken);
    const row = await this.refreshRepo.findOne({ where: { tokenHash } });
    if (row && !row.revokedAt) {
      row.revokedAt = new Date();
      await this.refreshRepo.save(row);
    }
  }

  private async revokeAllRefreshTokens(userId: string): Promise<void> {
    await this.refreshRepo
      .createQueryBuilder()
      .update()
      .set({ revokedAt: () => 'NOW()' })
      .where('userId = :userId AND revokedAt IS NULL', { userId })
      .execute();
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.refreshRepo
      .createQueryBuilder()
      .update()
      .set({ revokedAt: () => 'NOW()' })
      .where('familyId = :familyId AND revokedAt IS NULL', { familyId })
      .execute();
  }

  // ─────────────────────────────────────────────────────────────
  // Email token helpers
  // ─────────────────────────────────────────────────────────────

  /** 인증 메일 발송 + 사용자에게 이미 보낸 미사용 토큰은 만료 처리 */
  private async dispatchVerification(user: UserEntity): Promise<void> {
    if (!user.email) return;
    await this.expirePendingTokens(user.id, 'verify_email');
    const raw = generateRandomToken();
    await this.emailTokenRepo.save(
      this.emailTokenRepo.create({
        userId: user.id,
        purpose: 'verify_email',
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS),
      }),
    );
    const link = `${this.getWebAppUrl()}/auth/verify-email?token=${encodeURIComponent(raw)}`;
    await this.emailService.sendVerification(user.email, link);
  }

  private async dispatchPasswordReset(user: UserEntity): Promise<void> {
    if (!user.email) return;
    await this.expirePendingTokens(user.id, 'reset_password');
    const raw = generateRandomToken();
    await this.emailTokenRepo.save(
      this.emailTokenRepo.create({
        userId: user.id,
        purpose: 'reset_password',
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      }),
    );
    // 웹 라우트는 `/reset-password` 다(`/auth/reset-password` 페이지는 없다 — 링크가 404 였음).
    const link = `${this.getWebAppUrl()}/reset-password?token=${encodeURIComponent(raw)}`;
    await this.emailService.sendPasswordReset(user.email, link);
  }

  private async consumeEmailToken(
    raw: string,
    purpose: EmailTokenPurpose,
  ): Promise<EmailTokenEntity> {
    const tokenHash = sha256(raw);
    const row = await this.emailTokenRepo.findOne({ where: { tokenHash, purpose } });
    if (!row) throw new BadRequestException('유효하지 않은 토큰이에요.');
    if (row.consumedAt) throw new BadRequestException('이미 사용된 토큰이에요.');
    if (row.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('토큰이 만료됐어요. 다시 요청해주세요.');
    }
    // 원자적 소비: 동시 요청이 둘 다 통과하지 못하도록 consumedAt IS NULL 조건으로만 갱신.
    const result = await this.emailTokenRepo
      .createQueryBuilder()
      .update()
      .set({ consumedAt: () => 'NOW()' })
      .where('id = :id AND consumedAt IS NULL', { id: row.id })
      .execute();
    if (!result.affected) {
      throw new BadRequestException('이미 사용된 토큰이에요.');
    }
    row.consumedAt = new Date();
    return row;
  }

  private async expirePendingTokens(
    userId: string,
    purpose: EmailTokenPurpose,
  ): Promise<void> {
    await this.emailTokenRepo
      .createQueryBuilder()
      .update()
      .set({ consumedAt: () => 'NOW()' })
      .where('userId = :userId AND purpose = :purpose AND consumedAt IS NULL', {
        userId,
        purpose,
      })
      .execute();
  }

  // ─────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────

  toSessionUser(user: UserEntity): SessionUserDto {
    return {
      id: user.id,
      nickname: user.nickname,
      ...(user.handle ? { handle: user.handle } : {}),
      ...(user.profileImageUrl ? { profileImageUrl: user.profileImageUrl } : {}),
      ...(user.email ? { email: user.email } : {}),
      emailVerified: Boolean(user.emailVerifiedAt),
      hasPassword: Boolean(user.passwordHash),
      isDemo: Boolean(user.isDemo),
    };
  }

  private getWebAppUrl(): string {
    return this.config.get<string>('WEB_APP_URL') ?? 'http://localhost:3000';
  }

  // ─────────────────────────────────────────────────────────────
  // Kakao internals (변경 없음)
  // ─────────────────────────────────────────────────────────────

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
    try {
      const res = await axios.post<{ access_token: string }>(
        'https://kauth.kakao.com/oauth/token',
        body,
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );
      return res.data.access_token;
    } catch (error) {
      throw new BadRequestException(this.getKakaoAuthErrorMessage(error, 'token'));
    }
  }

  private async getKakaoProfile(accessToken: string): Promise<KakaoProfile> {
    const res = await axios
      .get<{
        id: number;
        kakao_account?: {
          email?: string;
          profile?: { nickname?: string; profile_image_url?: string };
        };
      }>('https://kapi.kakao.com/v2/user/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      .catch((error) => {
        throw new BadRequestException(this.getKakaoAuthErrorMessage(error, 'profile'));
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

  private getKakaoAuthErrorMessage(error: unknown, phase: 'token' | 'profile'): string {
    if (!axios.isAxiosError(error)) {
      return '카카오 로그인을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.';
    }
    const status = error.response?.status;
    const kakaoError = this.extractKakaoError(error);
    if (status === 401 || kakaoError === 'invalid_client') {
      return '카카오 REST API 키 또는 Client Secret 설정이 맞지 않습니다. Client Secret을 켠 경우에만 KAKAO_CLIENT_SECRET을 넣어주세요.';
    }
    if (kakaoError === 'invalid_grant') {
      return '카카오 인증 코드가 만료됐습니다. 다시 로그인해주세요.';
    }
    if (phase === 'profile') {
      return '카카오 계정 정보를 불러오지 못했습니다. 동의 항목 설정을 확인한 뒤 다시 시도해주세요.';
    }
    return '카카오 인증 토큰을 발급받지 못했습니다. 리다이렉트 URI와 앱 키 설정을 확인해주세요.';
  }

  private extractKakaoError(error: AxiosError): string | undefined {
    const data = error.response?.data;
    if (!data || typeof data !== 'object') return undefined;
    const record = data as { error?: unknown; error_code?: unknown };
    if (typeof record.error === 'string') return record.error;
    if (typeof record.error_code === 'string') return record.error_code;
    return undefined;
  }
}

// ─────────────────────────────────────────────────────────────
// Free helpers (export 안 함)
// ─────────────────────────────────────────────────────────────

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function generateRandomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

function normalizeEmail(raw: string | undefined): string {
  return (raw ?? '').trim().toLowerCase();
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HAS_LETTER = /[a-zA-Z]/;
const HAS_DIGIT = /\d/;

function assertValidEmail(email: string): void {
  if (!EMAIL_REGEX.test(email)) {
    throw new BadRequestException('올바른 이메일 형식이 아니에요.');
  }
}

function assertValidPassword(password: string): void {
  if (!password || password.length < 8) {
    throw new BadRequestException('비밀번호는 8자 이상이어야 해요.');
  }
  if (!HAS_LETTER.test(password) || !HAS_DIGIT.test(password)) {
    throw new BadRequestException('비밀번호는 영문과 숫자를 모두 포함해야 해요.');
  }
}

