import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'node:crypto';
import { isUniqueViolation } from '../common/db-errors';
import { StorageService } from '../storage/storage.service';
import { FcmTokenService } from '../notification/fcm-token.service';
import { RefreshTokenEntity } from '../auth/entities/refresh-token.entity';
import { EmailTokenEntity } from '../auth/entities/email-token.entity';
import { UserEntity } from './user.entity';
import { WithdrawalReasonEntity } from './withdrawal-reason.entity';
import { WithdrawUserDto } from './dto/withdraw-user.dto';
import { DEFAULT_NOTIFICATION_PREFERENCES } from './notification-preferences.constants';
import { NICKNAME_MAX_LENGTH, NICKNAME_REQUIRED, NICKNAME_TOO_LONG } from './nickname.constants';
import { NOTIFICATION_PREFERENCE_KEYS } from './dto/update-notification-preferences.dto';
import {
  WITHDRAWAL_CONFIRM_PHRASE,
  type KakaoProfile,
  type NotificationPreferencesDto,
  type UpdateUserDto,
  type WithdrawalReasonCode,
} from '@tripick/types';

const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_REASON_DETAIL_LENGTH = 500;

export type PublicProfile = Omit<UserEntity, 'passwordHash'>;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly repo: Repository<UserEntity>,
    @InjectRepository(WithdrawalReasonEntity)
    private readonly withdrawalReasons: Repository<WithdrawalReasonEntity>,
    @InjectRepository(RefreshTokenEntity)
    private readonly refreshTokens: Repository<RefreshTokenEntity>,
    @InjectRepository(EmailTokenEntity)
    private readonly emailTokens: Repository<EmailTokenEntity>,
    private readonly storage: StorageService,
    private readonly fcmTokens: FcmTokenService,
  ) {}


  async findById(id: string): Promise<UserEntity | null> {
    return this.repo.findOneBy({ id });
  }

  /** 클라이언트에 돌려줘도 되는 프로필. passwordHash 등 민감 컬럼을 제거한다. */
  publicProfile(user: UserEntity): PublicProfile {
    const { passwordHash, ...safe } = user;
    void passwordHash;
    return safe;
  }

  async findByHandle(handle: string): Promise<UserEntity | null> {
    const normalized = handle.trim().toLowerCase();
    if (!normalized) return null;
    return this.repo.findOneBy({ handle: normalized });
  }

  async findByEmail(email: string): Promise<UserEntity | null> {
    if (!email) return null;
    return this.repo.findOneBy({ email });
  }

  async findOrCreateByKakao(profile: KakaoProfile): Promise<UserEntity> {
    // 1순위: 이미 카카오 ID 로 가입한 사용자
    const byKakao = await this.repo.findOneBy({ kakaoId: profile.id });
    if (byKakao) return byKakao;

    // 2순위: 같은 이메일로 이메일 가입한 사용자가 있으면 자동 merge — 카카오 연동 추가
    if (profile.email) {
      const byEmail = await this.findByEmail(profile.email.toLowerCase());
      if (byEmail) {
        byEmail.kakaoId = profile.id;
        if (!byEmail.profileImageUrl && profile.profileImageUrl) {
          byEmail.profileImageUrl = profile.profileImageUrl;
        }
        if (!byEmail.emailVerifiedAt) {
          // 카카오 가입자는 이메일 인증된 것으로 간주
          byEmail.emailVerifiedAt = new Date();
        }
        return this.repo.save(byEmail);
      }
    }

    // 3순위: 신규 가입 (카카오에서 이메일 동의받았으면 자동 인증)
    const user = this.repo.create({
      kakaoId: profile.id,
      nickname: profile.nickname,
      handle: await this.generateUniqueHandle(profile.nickname || profile.id),
    });
    if (profile.profileImageUrl !== undefined) {
      user.profileImageUrl = profile.profileImageUrl;
    }
    if (profile.email !== undefined) {
      user.email = profile.email.toLowerCase();
      user.emailVerifiedAt = new Date();
    }
    return this.repo.save(user);
  }

  /**
   * 신규 이메일 가입. **비밀번호는 저장하지 않는다** — 인증 전 대기 비밀번호는 그 신청이
   * 만든 인증 토큰(`EmailTokenEntity.pendingPasswordHash`)이 들고 있다가 링크를 누를 때
   * 승격된다. 계정에 대기 칸을 두면 같은 이메일로 들어온 여러 신청이 그 칸을 두고 다툰다.
   *
   * 같은 이메일로 동시에 두 요청이 들어오면 한쪽은 유니크 제약에 걸린다 — 그걸 그대로
   * 흘리면 500 이 난다. 이메일 충돌은 "이미 있는 계정"이므로 null 을 돌려주고 호출부가
   * 기존 계정 경로를 타게 하고, 핸들 충돌은 다른 후보로 다시 시도한다(핸들은 자동 생성값이라
   * 사용자에게 알릴 것이 없다).
   */
  async createEmailUser(params: {
    email: string;
    nickname: string;
  }): Promise<UserEntity | null> {
    const base = localPart(params.email) || params.nickname;
    const HANDLE_ATTEMPTS = 4;
    for (let attempt = 0; attempt < HANDLE_ATTEMPTS; attempt++) {
      // 마지막 시도는 랜덤 접미사로 확정 — 핸들만 계속 부딪히는 극단적 경우 대비.
      const handle =
        attempt < HANDLE_ATTEMPTS - 1
          ? await this.generateUniqueHandle(base)
          : randomizedHandle(slugifyHandle(base));
      try {
        return await this.repo.save(
          this.repo.create({
            email: params.email,
            nickname: params.nickname,
            handle,
          }),
        );
      } catch (error) {
        if (isUniqueViolation(error, 'email')) return null;
        if (isUniqueViolation(error, 'handle') && attempt < HANDLE_ATTEMPTS - 1) continue;
        throw error;
      }
    }
    return null;
  }

  /** 비밀번호 즉시 확정(재설정 플로우). 이메일 소유 증명이 끝난 상태 → 인증도 같이 처리. */
  async setPassword(id: string, passwordHash: string): Promise<UserEntity> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    user.passwordHash = passwordHash;
    if (!user.emailVerifiedAt) user.emailVerifiedAt = new Date();
    return this.repo.save(user);
  }

  /**
   * 이메일 인증 완료 처리 + 소비된 토큰이 들고 온 가입 신청 내용 적용.
   *
   * 값은 호출부(소비한 토큰)가 준 것만 켠다 — 계정에 남아 있는 값을 켜면 어느 신청의 것인지
   * 알 수 없다. 이미 비밀번호가 있는 계정은 손대지 않는다: 주인이 확정된 계정에 인증 링크로
   * 비밀번호를 심는 경로가 바로 계정 탈취다(변경은 재설정 플로우만).
   *
   * 닉네임도 비밀번호와 같은 조건에서만 적용한다. 계정 닉네임은 첫 신청이 정하는데 실제
   * 주인은 링크를 누른 신청이므로, 승격되는 신청의 이름으로 맞춰 준다 — 안 그러면 남의
   * 이메일로 먼저 가입해 둔 쪽이 정한 이름을 주인이 그대로 쓰게 된다.
   */
  async markEmailVerified(
    id: string,
    pending?: { passwordHash?: string | null; nickname?: string | null },
  ): Promise<void> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    if (pending?.passwordHash && !user.passwordHash) {
      user.passwordHash = pending.passwordHash;
      const nickname = (pending.nickname ?? '').trim();
      if (nickname && nickname.length <= NICKNAME_MAX_LENGTH) user.nickname = nickname;
    }
    if (!user.emailVerifiedAt) user.emailVerifiedAt = new Date();
    await this.repo.save(user);
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserEntity> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    if (dto.nickname !== undefined) {
      const trimmed = dto.nickname.trim();
      if (!trimmed) {
        throw new BadRequestException(NICKNAME_REQUIRED);
      }
      if (trimmed.length > NICKNAME_MAX_LENGTH) {
        throw new BadRequestException(NICKNAME_TOO_LONG);
      }
      user.nickname = trimmed;
    }
    if (dto.handle !== undefined) {
      user.handle = await this.validateHandle(dto.handle, id);
    }
    return this.repo.save(user);
  }

  /** 사용자가 직접 지정한 핸들 검증 + 중복 확인. 정규화된 값을 돌려준다. */
  private async validateHandle(raw: string, selfId: string): Promise<string> {
    const handle = raw.trim().toLowerCase();
    if (!HANDLE_REGEX.test(handle)) {
      throw new BadRequestException('아이디는 영문 소문자·숫자·밑줄 3~20자로 입력해주세요.');
    }
    const existing = await this.repo.findOneBy({ handle });
    if (existing && existing.id !== selfId) {
      throw new ConflictException('이미 사용 중인 아이디예요.');
    }
    return handle;
  }


  /**
   * base 를 슬러그화하고 충돌 시 숫자 suffix 를 붙여 유니크 핸들 생성.
   *
   * 이름에서 root 를 못 뽑으면(한글 닉네임 등) 순번 경쟁 대신 랜덤 핸들로 바로 간다.
   * 공용 root 로 순번을 돌리면 그 이름의 가입자가 늘어날수록 앞 순번을 전부 조회해서 지나가야
   * 하고(가입 1건당 최대 50번의 순차 DB 조회), 핸들 자체도 user, user1 … 로 식별값이 못 된다.
   */
  private async generateUniqueHandle(base: string): Promise<string> {
    const root = slugifyHandle(base);
    if (!root) return this.generateRandomHandle();
    for (let i = 0; i < 50; i++) {
      const candidate = i === 0 ? root : `${root}${i}`;
      const taken = await this.repo.findOneBy({ handle: candidate });
      if (!taken) return candidate;
    }
    // 극단적 충돌 — 랜덤 suffix 로 마무리
    return randomizedHandle(root);
  }

  /** root 없는 이름용 랜덤 핸들. 충돌 확률이 낮아 몇 번만 확인하고 넘어간다. */
  private async generateRandomHandle(): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const candidate = randomizedHandle('');
      const taken = await this.repo.findOneBy({ handle: candidate });
      if (!taken) return candidate;
    }
    // 5번 연속 부딪히는 건 사실상 불가능 — 그래도 왔다면 갈래를 크게 늘려 끝낸다.
    return `user${randomBytes(6).toString('hex')}`;
  }

  async updateNotificationPreferences(
    id: string,
    partial: Partial<NotificationPreferencesDto>,
  ): Promise<NotificationPreferencesDto> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    // 알려진 키만 남긴다. 컨트롤러 DTO 가 이미 걸러 주지만, jsonb 는 한 번 쓰레기가 들어가면
    // 계속 실려 다니므로 저장 직전에서도 좁힌다.
    user.notificationPreferences = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      ...pickKnownPreferences(user.notificationPreferences),
      ...pickKnownPreferences(partial),
    };
    await this.repo.save(user);
    return user.notificationPreferences;
  }

  /**
   * 단일 카테고리 수신 여부 — 미설정이면 default 적용. 각 카테고리는 자기 토글을 따른다.
   * 날씨·혼잡·미도착 추천은 UI 에서 한 스위치로 묶어 세 키를 함께 켜고 끄지만(맥락 변동 추천),
   * 재계획 완료(replan_ready)와는 분리돼 서로 영향을 주지 않는다.
   */
  prefersCategory(user: UserEntity, key: keyof NotificationPreferencesDto): boolean {
    const merged: NotificationPreferencesDto = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      ...(user.notificationPreferences ?? {}),
    };
    return merged[key] !== false;
  }

  /** 프로필 이미지 업로드 — 기존에 우리가 발급한 URL 이 있으면 같이 삭제. */
  async uploadProfileImage(
    id: string,
    file: { buffer: Buffer; mimetype: string; size: number },
  ): Promise<UserEntity> {
    if (!this.storage.isReady()) {
      throw new ServiceUnavailableException('스토리지가 설정되지 않았습니다.');
    }
    if (!ALLOWED_IMAGE_MIME.has(file.mimetype)) {
      throw new BadRequestException('JPG, PNG, WebP 이미지만 업로드할 수 있어요.');
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new BadRequestException('이미지 크기는 5MB 이하만 업로드할 수 있어요.');
    }

    const user = await this.findById(id);
    if (!user) throw new NotFoundException(`User ${id} not found`);

    const ext = extForMime(file.mimetype);
    const key = `public/profiles/${user.id}/${Date.now()}.${ext}`;
    const url = await this.storage.putObject({
      key,
      body: file.buffer,
      contentType: file.mimetype,
    });

    // 직전에 우리가 올린 이미지가 있으면 정리. 카카오 등 외부 URL 은 건드리지 않음.
    if (user.profileImageUrl) {
      const oldKey = this.storage.keyFromPublicUrl(user.profileImageUrl);
      if (oldKey) void this.storage.deleteObject(oldKey);
    }

    user.profileImageUrl = url;
    return this.repo.save(user);
  }

  /** 사용자가 직접 올린 이미지를 제거하고 기본(아바타 이니셜) 상태로 되돌린다. */
  async removeProfileImage(id: string): Promise<UserEntity> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    if (user.profileImageUrl) {
      const oldKey = this.storage.keyFromPublicUrl(user.profileImageUrl);
      if (oldKey) await this.storage.deleteObject(oldKey);
    }
    // exactOptionalPropertyTypes 때문에 update 객체로 null 전달이 막혀 query builder 사용.
    await this.repo
      .createQueryBuilder()
      .update(UserEntity)
      .set({ profileImageUrl: () => 'NULL' })
      .where('id = :id', { id })
      .execute();
    delete user.profileImageUrl;
    return user;
  }

  async remove(id: string): Promise<void> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    await this.removeUser(user);
  }

  /**
   * 회원 탈퇴. 확인 문구(WITHDRAWAL_CONFIRM_PHRASE)를 그대로 입력한 요청만 통과시키고,
   * 계정을 즉시 물리 삭제한다(soft delete·유예 없음 — 결제 이력이 없어 데이터 보관 의무가
   * 없고, 삭제 요청은 즉시 이행하는 게 원칙에 맞음). 사유는 삭제가 끝난 뒤 익명 row 로 남긴다
   * — 삭제가 실패했는데 사유만 쌓여 집계가 부풀지 않도록.
   */
  async withdraw(id: string, dto: WithdrawUserDto): Promise<void> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException(`User ${id} not found`);

    if (dto.confirmation?.trim() !== WITHDRAWAL_CONFIRM_PHRASE) {
      throw new BadRequestException(`탈퇴하려면 "${WITHDRAWAL_CONFIRM_PHRASE}"를 입력해주세요.`);
    }

    const accountAgeDays = daysSince(user.createdAt);
    const detail = dto.reasonDetail?.trim().slice(0, MAX_REASON_DETAIL_LENGTH);
    await this.removeUser(user);
    await this.recordWithdrawalReason(dto.reason, detail || undefined, accountAgeDays);
  }

  /**
   * 계정 + 세션 흔적 삭제. FK cascade 가 걸린 테이블은 자동으로 지워지지만, FK 없이 userId
   * 컬럼만 가진 테이블(fcm_tokens·refresh_tokens·email_tokens)은 여기서 직접 지운다 —
   * 특히 refresh 토큰이 남으면 탈퇴 후에도 /auth/refresh 가 계속 새 토큰을 발급한다.
   */
  private async removeUser(user: UserEntity): Promise<void> {
    await this.fcmTokens.removeAllForUser(user.id);
    await this.refreshTokens.delete({ userId: user.id });
    await this.emailTokens.delete({ userId: user.id });
    await this.repo.remove(user);
  }

  /** 사유 적재는 탈퇴 자체를 막지 않는다 — 실패하면 로그만 남긴다(계정은 이미 삭제됨). */
  private async recordWithdrawalReason(
    reason: WithdrawalReasonCode | undefined,
    detail: string | undefined,
    accountAgeDays: number,
  ): Promise<void> {
    try {
      await this.withdrawalReasons.save(
        this.withdrawalReasons.create({
          reason: reason ?? null,
          detail: detail ?? null,
          accountAgeDays,
        }),
      );
    } catch (error) {
      this.logger.warn(`탈퇴 사유 기록 실패: ${(error as Error).message}`);
    }
  }
}

/** 알려진 알림 카테고리 + boolean 값만 통과시킨다. */
function pickKnownPreferences(
  source: Partial<NotificationPreferencesDto> | null | undefined,
): Partial<NotificationPreferencesDto> {
  if (!source) return {};
  const picked: Partial<NotificationPreferencesDto> = {};
  for (const key of NOTIFICATION_PREFERENCE_KEYS) {
    const value = source[key];
    if (typeof value === 'boolean') picked[key] = value;
  }
  return picked;
}

/** 가입 후 경과일(음수 방지). 탈퇴 사유 해석용 부가 정보. */
function daysSince(date: Date): number {
  const ageMs = Date.now() - new Date(date).getTime();
  return Math.max(0, Math.floor(ageMs / 86_400_000));
}

function extForMime(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'bin';
}

const HANDLE_MAX_LENGTH = 20;
const HANDLE_REGEX = new RegExp(`^[a-z0-9_]{3,${HANDLE_MAX_LENGTH}}$`);

/** 이메일의 @ 앞부분(local-part)을 소문자로. 이메일이 없으면 빈 문자열. */
function localPart(email?: string | null): string {
  return (email ?? '').split('@')[0]?.trim().toLowerCase() ?? '';
}

/**
 * 임의 문자열 → 핸들 슬러그. 영숫자/언더스코어만 남기고 3~20자로 맞춘다.
 * 남는 글자가 없으면(한글 등 비-ASCII 이름) **빈 문자열**을 돌려준다 — 여기서 'user' 같은
 * 공용 root 를 만들어 주면 그 이름의 모든 신규 가입자가 user, user1, user2 … 순번을 다툰다.
 * 이름에서 root 를 못 뽑았다는 사실은 호출부가 알아야 랜덤 핸들로 흩을 수 있다.
 */
function slugifyHandle(base: string): string {
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '')
    .slice(0, HANDLE_MAX_LENGTH);
  if (slug.length >= 3) return slug;
  if (slug.length === 0) return '';
  return slug.padEnd(3, '0'); // 1~2자 → ab0, a00
}

/**
 * 자동 생성 핸들에 랜덤 접미사를 붙인다. root 가 비면 'user' 를 쓰되 순번이 아니라 랜덤이라
 * 서로 부딪히지 않는다(6자 hex = 1,600만 갈래).
 * 사용자가 직접 지정하는 핸들과 같은 20자 상한을 지키도록 root 를 먼저 자른다.
 */
function randomizedHandle(root: string): string {
  const suffix = randomBytes(3).toString('hex'); // 6자
  const stem = (root || 'user').slice(0, HANDLE_MAX_LENGTH - suffix.length);
  return `${stem}${suffix}`;
}
