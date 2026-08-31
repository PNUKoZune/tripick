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
import { IsNull, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import axios, { type AxiosError } from 'axios';
import * as Sentry from '@sentry/nestjs';

import { UsersService } from '../users/users.service';
import { UserEntity } from '../users/user.entity';
import { EmailService } from '../email/email.service';
import { JWT_ALGORITHM, refreshTokenSecret } from '../common/jwt-secrets';
import { EmailTokenEntity, type EmailTokenPurpose } from './entities/email-token.entity';
import { RefreshTokenEntity } from './entities/refresh-token.entity';
import {
  NICKNAME_MAX_LENGTH,
  NICKNAME_REQUIRED,
  NICKNAME_TOO_LONG,
} from '../users/nickname.constants';
import type {
  AuthOpResultDto,
  AuthTokens,
  ChangePasswordDto,
  EmailLoginDto,
  EmailSignupDto,
  KakaoAuthStatusDto,
  KakaoProfile,
  LoginResponseDto,
  SessionUserDto,
} from '@tripick/types';

const BCRYPT_COST = 12;
/**
 * 존재하지 않는 계정의 로그인 시도에 비교 비용을 맞추기 위한 더미 해시(같은 cost).
 * 임의 문자열을 해싱한 값이라 어떤 비밀번호와도 매치되지 않는다.
 */
const DUMMY_PASSWORD_HASH = '$2b$12$wrlYsup.IgWNCmwr2WfDBu7tmvjWXnoardK5j5XxbIrNEs6Ffp3ce';
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** 이 시간 안의 재사용은 탈취가 아니라 경합·재시도로 본다 (family 폐기 대상에서 제외). */
const REFRESH_ROTATION_GRACE_MS = 30 * 1000;

/** 앱 복귀용 커스텀 스킴. 모바일 셸의 URL scheme(iOS) · intent scheme(Android) 과 같은 값이다. */
const APP_SCHEME = 'tripick';
const ANDROID_PACKAGE = 'com.tripick.place';

/**
 * 카카오 로그인을 시작한 실행 환경. 앱에서 시작했으면 그 앱으로 돌려보내야 한다 —
 * 웹 URL 로 답하면 로그인은 브라우저에서 끝나고, 교환 코드를 쓸 bind 는 앱 웹뷰에만 있어
 * 사용자는 "로그인했는데 앱은 그대로" 인 상태가 된다.
 */
export type KakaoReturnTarget = 'web' | 'android' | 'ios';

export function normalizeKakaoReturnTarget(value: string | undefined | null): KakaoReturnTarget {
  return value === 'android' || value === 'ios' ? value : 'web';
}

function getAppSchemeUrl(params: Record<string, string>): string {
  return `${APP_SCHEME}://auth/kakao/callback?${new URLSearchParams(params).toString()}`;
}

/** 인증 링크가 켤 가입 신청 내용. 같은 신청에서 나온 값이라 항상 같이 움직인다. */
interface PendingSignup {
  passwordHash: string;
  nickname?: string | null;
}

export interface TokenContext {
  userAgent?: string;
  ipAddress?: string;
}

/**
 * 카카오 로그인 동의항목. **카카오 개발자 콘솔에서 활성화한 항목만** 실을 수 있다 —
 * 콘솔에 없는 항목을 scope 로 보내면 로그인이 KOE205 로 아예 막힌다.
 *
 * 명시하지 않으면 콘솔 기본 동의항목만 내려오는데, 닉네임이 빠지면 사용자 이름이 전부
 * 폴백('여행자')으로, 핸들도 이름에서 root 를 못 뽑아 랜덤값으로 찍힌다. 이메일이 빠지면
 * 같은 사람이 이메일로 가입했을 때 `findOrCreateByKakao` 의 자동 merge 를 못 타 계정이 갈린다.
 */
const KAKAO_SCOPES = ['profile_nickname', 'account_email'] as const;

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
    if (!nickname) throw new BadRequestException(NICKNAME_REQUIRED);
    if (nickname.length > NICKNAME_MAX_LENGTH) throw new BadRequestException(NICKNAME_TOO_LONG);

    // 계정 유무와 무관하게 항상 해싱한다 — 신규 경로에서만 cost 12 를 치르면 기존 계정일 때
    // 응답이 눈에 띄게 빨라져, 고정 응답으로 막아 둔 가입 여부가 시간차로 새어 나간다.
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);

    let existing = await this.usersService.findByEmail(email);
    if (!existing) {
      const created = await this.usersService.createEmailUser({ email, nickname });
      if (created) {
        await this.dispatchVerification(created, { passwordHash, nickname });
        return signupResult(email);
      }
      // 동시 가입 경쟁에서 졌다(유니크 충돌) — 상대가 방금 만든 계정을 다시 읽어
      // 아래 기존 계정 경로로 간다. 예전엔 이 충돌이 그대로 올라가 500 이 났다.
      existing = await this.usersService.findByEmail(email);
    }

    // 아직 아무도 인증하지 않은 가입 신청이면 안내가 아니라 **인증 메일을 다시 보낸다.**
    // 메일을 못 받았거나 놓쳐서 다시 가입을 누르는 게 이 상태의 거의 전부라, 여기서
    // "이미 가입된 계정" 안내를 보내면 막다른 길이 된다 (재설정으로 유도해도 인증 전이라 헛돈다).
    //
    // 이번 요청의 비밀번호는 **이번에 보내는 토큰에만** 실린다. 계정에 대기 칸을 두고 먼저
    // 심은 쪽이 이기게 하면 남의 이메일을 선점해 두고 주인이 자기 가입 링크를 누르는 순간
    // 공격자 비밀번호가 켜지고, 나중 신청이 이기게 하면 주인이 기다리던 링크의 의미가 바뀐다.
    // 토큰이 각자 자기 신청을 들고 있으면 **누른 링크의 비밀번호·닉네임**만 켜진다.
    // (`passwordHash` 까지 보는 건 방어적 조건이다 — 값이 있으면 인증을 마친 계정이므로
    //  emailVerifiedAt 이 어떤 이유로 비어 있어도 주인 있는 계정으로 취급한다.)
    if (existing && !existing.emailVerifiedAt && !existing.kakaoId && !existing.passwordHash) {
      await this.dispatchVerification(existing, { passwordHash, nickname });
      return signupResult(email);
    }

    // 여기부터는 주인이 확정된 계정(이메일 인증 완료 또는 카카오 가입)이다.
    // 이런 계정에는 절대 비밀번호를 심지 않는다. 예전에는 pending 으로 받아 두고
    // 인증 링크로 승격했는데, 그 링크는 **계정 주인**에게 간다 — 주인이 "가입 인증"
    // 메일로 알고 누르는 순간 공격자가 넣은 비밀번호가 활성화돼 계정이 넘어갔다.
    // 대신 주인에게 상황만 알리고, 비밀번호 설정은 재설정 플로우로 보낸다.
    await this.deliver(email, () =>
      this.emailService.sendAccountExistsNotice(email, {
        hasPassword: Boolean(existing?.passwordHash),
        resetUrl: `${this.getWebAppUrl()}/forgot-password`,
        loginUrl: `${this.getWebAppUrl()}/login`,
      }),
    );
    return signupResult(email);
  }

  async loginWithEmail(dto: EmailLoginDto, ctx: TokenContext = {}): Promise<LoginResponseDto> {
    const email = normalizeEmail(dto.email);
    if (!email || !dto.password) {
      throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않아요.');
    }
    const user = await this.usersService.findByEmail(email);
    if (!user || !user.passwordHash) {
      // 비밀번호가 아직 pending(인증 전)인 사용자는 인증을 안내한다. 대기 비밀번호는 계정이
      // 아니라 살아 있는 인증 토큰이 들고 있으므로 거기서 꺼내 맞춰 본다.
      // 403 으로 던져야 클라이언트가 메시지를 그대로 노출(401 은 만료 안내로 치환됨).
      const pending = user ? await this.livePendingSignup(user.id) : null;
      if (pending && (await bcrypt.compare(dto.password, pending.passwordHash))) {
        throw new ForbiddenException('이메일 인증을 완료해야 로그인할 수 있어요. 메일함을 확인해주세요.');
      }
      // 계정이 없어도 해시 비교 비용을 똑같이 치른다. 바로 던지면 cost 12 짜리 bcrypt 를
      // 건너뛰어 응답이 눈에 띄게 빨라지고, 그 시간차만으로 가입 여부를 훑을 수 있다.
      if (!pending) {
        await bcrypt.compare(dto.password, DUMMY_PASSWORD_HASH);
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

    // 소비 전에 사용자부터 확인한다 — 순서가 반대면 계정이 없을 때 토큰만 태워지고
    // 사용자는 이미 죽은 링크를 들고 재발송을 받아야 한다.
    const record = await this.findUsableEmailToken(token, 'verify_email');
    const user = await this.usersService.findById(record.userId);
    if (!user) throw new NotFoundException('사용자를 찾을 수 없어요.');
    await this.consumeEmailToken(record);
    // 켜지는 비밀번호·닉네임은 **이 토큰이 들고 온 것**이다 — 계정에 남은 값을 켜면 어느
    // 신청의 것인지 알 수 없다(같은 이메일로 여러 신청이 들어올 수 있다).
    await this.usersService.markEmailVerified(user.id, {
      passwordHash: record.pendingPasswordHash ?? null,
      nickname: record.pendingNickname ?? null,
    });
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

    const record = await this.findUsableEmailToken(token, 'reset_password');
    const user = await this.usersService.findById(record.userId);
    if (!user) throw new NotFoundException('사용자를 찾을 수 없어요.');
    await this.consumeEmailToken(record);
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    await this.usersService.setPassword(record.userId, passwordHash);
    // 살아 있던 가입 신청은 여기서 전부 무효화한다. 재설정으로 이메일 소유가 증명됐고
    // 비밀번호도 확정됐는데, 자기 비밀번호를 들고 있는 인증 토큰을 남겨 두면 그 토큰을 쥔
    // 쪽이 나중에 이 계정 상태를 건드릴 여지가 남는다.
    await this.expirePendingTokens(record.userId, 'verify_email');
    // 비밀번호 변경 = 다른 디바이스 모두 로그아웃
    await this.revokeAllRefreshTokens(record.userId);
    return { ok: true, message: '비밀번호가 변경됐어요. 새 비밀번호로 로그인해주세요.' };
  }

  /**
   * 로그인 상태에서의 비밀번호 변경. 재설정과 달리 메일 왕복이 없으므로 **현재 비밀번호**가
   * 본인 확인의 전부다 — 세션만으로 통과시키면 잠깐 열어 둔 기기나 탈취된 access token 이
   * 그대로 계정 인수가 된다(비밀번호를 갈고 나머지 세션을 폐기하면 주인이 밀려난다).
   *
   * 비밀번호가 없는 계정(카카오 단독 가입)은 여기서 받지 않는다. 대조할 값이 없어 확인이
   * 세션 하나로 줄어드는 데다, 기존 계정에 비밀번호를 다는 경로는 이메일 소유를 다시
   * 증명하는 재설정 플로우 하나로 유지한다.
   *
   * 성공하면 이 기기만 새 토큰으로 이어 간다 — 남의 손에 있을 수 있는 다른 기기의 refresh
   * 는 전부 끊고(변경 이유가 보통 그것이다), 정작 비밀번호를 바꾼 사람만 로그아웃시키지 않는다.
   */
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    ctx: TokenContext = {},
  ): Promise<LoginResponseDto> {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('사용자를 찾을 수 없어요.');
    if (!user.passwordHash) {
      throw new BadRequestException(
        '아직 비밀번호가 없는 계정이에요. 비밀번호 설정 메일로 등록해주세요.',
      );
    }
    // 401 이 아니라 403 이다 — 클라이언트는 인증된 요청의 401 을 "세션 만료" 로 읽어
    // 로그인 화면으로 보내 버린다. 틀린 건 세션이 아니라 입력한 현재 비밀번호다.
    if (!(await bcrypt.compare(dto.currentPassword ?? '', user.passwordHash))) {
      throw new ForbiddenException('현재 비밀번호가 올바르지 않아요.');
    }
    assertValidPassword(dto.newPassword);
    if (await bcrypt.compare(dto.newPassword, user.passwordHash)) {
      throw new BadRequestException('지금 쓰는 비밀번호와 다른 값으로 바꿔주세요.');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_COST);
    await this.usersService.setPassword(userId, passwordHash);
    // 살아 있던 재설정·가입 링크는 여기서 무효화한다. 방금 주인이 비밀번호를 확정했는데
    // 옛 링크로 그 값을 다시 덮을 수 있으면 변경한 의미가 없다(재설정 메일을 띄워 놓고
    // 기기를 빼앗긴 경우가 정확히 이 시나리오다).
    await this.expirePendingTokens(userId, 'reset_password');
    await this.expirePendingTokens(userId, 'verify_email');
    // 다른 기기는 전부 로그아웃 → 이 기기만 새 토큰으로 다시 잇는다.
    await this.revokeAllRefreshTokens(userId);
    const tokens = await this.issueTokens(userId, ctx);
    return { tokens, user: this.toSessionUser({ ...user, passwordHash }) };
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
      scope: KAKAO_SCOPES.join(','),
      state,
    });
    return {
      authorizeUrl: `https://kauth.kakao.com/oauth/authorize?${params.toString()}`,
      state,
    };
  }

  getKakaoStatus(): KakaoAuthStatusDto {
    const missingKeys = this.missingKakaoKeys();
    if (missingKeys.length > 0) return { ready: false, missingKeys };
    return { ready: true, startUrl: this.kakaoStartUrl() };
  }

  /**
   * 로그인 시작 URL. 등록된 콜백 URL 에서 `/callback` 만 떼어 만든다 — 시작과 콜백이 반드시
   * 같은 오리진이어야 state 쿠키가 왕복한다(웹 프록시 경유로 시작하면 오리진이 갈린다).
   */
  private kakaoStartUrl(): string {
    const { redirectUri } = this.requireKakaoConfig();
    return redirectUri.replace(/\/callback\/*$/, '');
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

  /**
   * 인가 코드로 카카오 프로필을 받아, **이미 계정이 있으면** 로그인시키고 **처음이면**
   * 계정을 만들지 않은 채 프로필만 돌려준다. 신규 가입은 약관 동의를 받은 뒤
   * {@link completeKakaoSignup} 에서 이뤄진다 — 동의 화면을 닫고 떠난 사람의 계정이
   * 남지 않게 하려면 여기서 만들면 안 된다.
   */
  async resolveKakaoLogin(
    code: string,
    ctx: TokenContext = {},
  ): Promise<
    { kind: 'session'; session: LoginResponseDto } | { kind: 'consent'; profile: KakaoProfile }
  > {
    const kakaoToken = await this.getKakaoToken(code);
    const profile = await this.getKakaoProfile(kakaoToken);
    if (!(await this.usersService.existsForKakao(profile))) {
      return { kind: 'consent', profile };
    }
    return { kind: 'session', session: await this.signInWithKakaoProfile(profile, ctx) };
  }

  /** 약관 동의를 마친 카카오 프로필로 계정을 만들고 로그인시킨다. */
  async completeKakaoSignup(
    profile: KakaoProfile,
    ctx: TokenContext = {},
  ): Promise<LoginResponseDto> {
    return this.signInWithKakaoProfile(profile, ctx);
  }

  private async signInWithKakaoProfile(
    profile: KakaoProfile,
    ctx: TokenContext,
  ): Promise<LoginResponseDto> {
    const user = await this.usersService.findOrCreateByKakao(profile);
    // 카카오 로그인은 이메일 소유를 증명하고 계정을 인증 상태로 만든다(같은 이메일의 미인증
    // 가입은 여기서 merge 된다). 그때 대기 중이던 가입 신청 토큰을 남겨 두면, 그 토큰을 쥔
    // 쪽이 나중에 링크를 태워 이 계정에 비밀번호를 심을 수 있다 — 카카오 단독 계정은
    // passwordHash 가 비어 있어 승격 가드에도 안 걸린다. 이메일 비밀번호는 재설정으로만.
    await this.expirePendingTokens(user.id, 'verify_email');
    const tokens = await this.issueTokens(user.id, ctx);
    return { tokens, user: this.toSessionUser(user) };
  }

  /**
   * 성공 리다이렉트 URL. 세션 자체가 아니라 1회용 교환 코드만 싣는다 — 예전엔 refresh
   * 토큰까지 통째로 프래그먼트에 실려 브라우저 히스토리에 30일짜리 자격증명이 남았다.
   * 프래그먼트를 유지하는 건 쿼리와 달리 Referer·서버 로그에 아예 안 실리기 때문.
   */
  getWebKakaoSuccessUrl(code: string): string {
    const url = new URL('/auth/kakao/callback', this.getWebAppUrl());
    url.hash = `code=${encodeURIComponent(code)}`;
    return url.toString();
  }

  getWebKakaoErrorUrl(message: string): string {
    const url = new URL('/auth/kakao/callback', this.getWebAppUrl());
    url.searchParams.set('error', message);
    return url.toString();
  }

  /** 로그인을 시작한 곳으로 돌려보낸다. 앱에서 시작했는데 웹 URL 로 답하면 세션이 브라우저에 갇힌다. */
  getKakaoSuccessUrl(code: string, target: KakaoReturnTarget = 'web'): string {
    switch (target) {
      case 'android':
        return this.getAndroidKakaoIntentUrl({ code }, this.getWebKakaoSuccessUrl(code));
      case 'ios':
        return getAppSchemeUrl({ code });
      default:
        return this.getWebKakaoSuccessUrl(code);
    }
  }

  getKakaoErrorUrl(message: string, target: KakaoReturnTarget = 'web'): string {
    switch (target) {
      case 'android':
        return this.getAndroidKakaoIntentUrl({ error: message }, this.getWebKakaoErrorUrl(message));
      case 'ios':
        return getAppSchemeUrl({ error: message });
      default:
        return this.getWebKakaoErrorUrl(message);
    }
  }

  /**
   * Android 는 `intent://` 로 돌려보낸다 — package 를 못박아 두면 사용자가 App Link 열기를
   * 꺼 뒀어도 앱으로 돌아오고, 앱이 없으면 `browser_fallback_url` 로 웹이 열린다.
   * (iOS 에는 `intent://` 가 없어 커스텀 스킴을 그대로 쓴다)
   */
  private getAndroidKakaoIntentUrl(params: Record<string, string>, fallbackUrl: string): string {
    const query = new URLSearchParams(params).toString();
    return (
      `intent://auth/kakao/callback?${query}` +
      `#Intent;scheme=${APP_SCHEME};package=${ANDROID_PACKAGE};` +
      `S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};end`
    );
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
    const accessToken = await this.jwtService.signAsync({ sub: userId });
    // jti 로 매 발급을 유일하게 만든다. payload 가 { sub } 뿐이면 iat 가 초 단위라 같은 초에
    // 발급된 두 refresh 토큰이 바이트까지 동일해지고, tokenHash 유니크 인덱스에 걸려 500 이
    // 난다 — 로그인 직후 같은 초에 갱신하면 재현된다(로그인끼리는 bcrypt 비용이 초를 벌려 준다).
    const refreshToken = await this.jwtService.signAsync(
      { sub: userId, jti: generateRandomToken(16) },
      {
        secret: this.refreshSecret,
        algorithm: JWT_ALGORITHM,
        expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN', '30d'),
      },
    );

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
        algorithms: [JWT_ALGORITHM],
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
      // 방금 회전된 토큰이면 탈취가 아니라 경합이다 — 응답을 못 받은 클라이언트의 재시도,
      // 또는 웹·네이티브가 동시에 갱신한 경우. 여기서 family 를 폐기하면 바로 직전에
      // **정상 발급된 새 토큰까지** 죽어서 멀쩡한 세션이 통째로 날아간다. 이 요청만 거절한다.
      if (Date.now() - row.replacedAt.getTime() <= REFRESH_ROTATION_GRACE_MS) {
        throw new UnauthorizedException('Refresh token already rotated');
      }
      // 한참 지난 뒤 다시 쓰인 옛 토큰 — 탈취 의심.
      this.logger.warn(
        `Refresh token reuse detected for user=${row.userId} family=${row.familyId}`,
      );
      await this.revokeFamily(row.familyId);
      throw new UnauthorizedException('Refresh token reused');
    }
    if (row.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    // 회전 권한을 원자적으로 선점한다. 위 검사와 발급 사이에 다른 요청이 끼어들면
    // 같은 토큰으로 두 벌이 발급되고 한 벌은 주인 없이 30일을 살아남는다.
    // 조건부 UPDATE 의 affected 로 승자를 가리고, 진 쪽은 발급하지 않는다.
    const claimed = await this.refreshRepo
      .createQueryBuilder()
      .update()
      .set({ replacedAt: () => 'NOW()' })
      .where('id = :id AND "replacedAt" IS NULL AND "revokedAt" IS NULL', { id: row.id })
      .execute();
    if (!claimed.affected) {
      throw new UnauthorizedException('Refresh token already rotated');
    }

    // rotation: 같은 family 로 새 토큰 발급
    return this.issueTokens(row.userId, ctx, row.familyId);
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

  /**
   * 인증 메일 발송 + 사용자에게 이미 보낸 미사용 토큰은 만료 처리.
   *
   * `pending` 은 이 신청이 인증되면 계정에 적용될 값이다. 재발송처럼 자기 신청 내용이 없는
   * 호출은 지금 살아 있는 토큰의 것을 **이어받는다** — 안 그러면 재발송 링크가 인증만 하고
   * 비밀번호는 없는 계정을 만들어, 방금 가입한 사용자가 로그인을 못 한다.
   */
  private async dispatchVerification(user: UserEntity, pending?: PendingSignup): Promise<void> {
    const email = user.email;
    if (!email) return;
    // 만료시키기 전에 읽어야 한다 — expirePendingTokens 가 먼저 돌면 이어받을 값이 사라진다.
    const carried = pending ?? (await this.livePendingSignup(user.id));
    await this.expirePendingTokens(user.id, 'verify_email');
    const raw = generateRandomToken();
    await this.emailTokenRepo.save(
      this.emailTokenRepo.create({
        userId: user.id,
        purpose: 'verify_email',
        tokenHash: sha256(raw),
        pendingPasswordHash: carried?.passwordHash ?? null,
        pendingNickname: carried?.nickname ?? null,
        expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS),
      }),
    );
    const link = `${this.getWebAppUrl()}/auth/verify-email?token=${encodeURIComponent(raw)}`;
    await this.deliver(email, () => this.emailService.sendVerification(email, link));
  }

  private async dispatchPasswordReset(user: UserEntity): Promise<void> {
    const email = user.email;
    if (!email) return;
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
    await this.deliver(email, () => this.emailService.sendPasswordReset(email, link));
  }

  /**
   * 메일 발송 실패를 응답으로 올리지 않는다 — 토큰·계정은 이 시점에 이미 커밋됐고,
   * 호출부의 응답은 enumeration 방지로 어차피 성공/실패를 구분하지 않는 고정 문구다.
   * 여기서 던지면 "계정은 만들어졌는데 가입은 500" 같은 어긋난 상태만 사용자에게 보인다.
   * 실패는 로그·Sentry 로 남기고, 사용자는 재발송/재설정 요청으로 복구한다.
   *
   * Sentry 는 **직접** 올려야 한다 — 전역 필터(SentryGlobalFilter)는 응답까지 올라온 예외만
   * 잡고, Nest Logger 는 Sentry 로 흐르지 않는다. 삼킨 예외를 그냥 두면 사용자에겐 200 이
   * 나가고 메일만 조용히 안 가는 상태가 아무 알림 없이 계속된다.
   */
  private async deliver(to: string, send: () => Promise<void>): Promise<void> {
    try {
      await send();
    } catch (err) {
      this.logger.error(`메일 발송 실패 (to=${to}): ${(err as Error).message}`);
      // 수신 주소는 태그가 아니라 본문에만 둔다 — 태그는 인덱싱돼 검색·그룹핑에 노출된다.
      Sentry.captureException(err, {
        tags: { area: 'auth-email' },
        extra: { recipientDomain: to.split('@')[1] ?? 'unknown' },
      });
    }
  }

  /**
   * 아직 살아 있는 인증 토큰이 들고 있는 가입 신청 내용. 없으면 null.
   * 재발송이 이어받을 값이자, 로그인 실패 시 "인증부터 하세요" 안내를 가를 기준이다.
   */
  private async livePendingSignup(userId: string): Promise<PendingSignup | null> {
    const row = await this.emailTokenRepo.findOne({
      where: { userId, purpose: 'verify_email', consumedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    if (!row?.pendingPasswordHash) return null;
    if (row.expiresAt.getTime() < Date.now()) return null;
    return { passwordHash: row.pendingPasswordHash, nickname: row.pendingNickname ?? null };
  }

  /** 아직 쓸 수 있는 토큰 조회. 소비는 하지 않는다 — 부수효과 전에 사전 조건을 다 보려고 분리했다. */
  private async findUsableEmailToken(
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
    return row;
  }

  /** 원자적 소비: 동시 요청이 둘 다 통과하지 못하도록 consumedAt IS NULL 조건으로만 갱신. */
  private async consumeEmailToken(row: EmailTokenEntity): Promise<void> {
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

/** 신규 가입과 기존 계정이 완전히 같은 응답을 내야 한다 — 다르면 그 자체로 가입 여부 조회 API 가 된다. */
function signupResult(email: string): AuthOpResultDto {
  return {
    ok: true,
    message: '인증 메일을 보냈어요. 메일을 확인해 가입을 완료해주세요.',
    email,
  };
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
