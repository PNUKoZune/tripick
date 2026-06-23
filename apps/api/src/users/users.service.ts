import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StorageService } from '../storage/storage.service';
import { UserEntity } from './user.entity';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type KakaoProfile,
  type NotificationPreferencesDto,
  type UpdateUserDto,
} from '@tripick/types';

const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly repo: Repository<UserEntity>,
    private readonly storage: StorageService,
  ) {}

  async findById(id: string): Promise<UserEntity | null> {
    return this.repo.findOneBy({ id });
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

  /** 신규 이메일 가입. 비밀번호는 인증 전이므로 pending 으로만 저장한다. */
  async createEmailUser(params: {
    email: string;
    passwordHash: string;
    nickname: string;
  }): Promise<UserEntity> {
    const user = this.repo.create({
      email: params.email,
      pendingPasswordHash: params.passwordHash,
      nickname: params.nickname,
    });
    return this.repo.save(user);
  }

  /** 계정 연동/재가입 시 인증 대기 비밀번호 설정. 활성 passwordHash 는 건드리지 않는다. */
  async setPendingPassword(id: string, passwordHash: string): Promise<UserEntity> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    user.pendingPasswordHash = passwordHash;
    return this.repo.save(user);
  }

  /** 비밀번호 즉시 확정(재설정 플로우). 이메일 소유 증명이 끝난 상태 → 인증도 같이 처리. */
  async setPassword(id: string, passwordHash: string): Promise<UserEntity> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    user.passwordHash = passwordHash;
    user.pendingPasswordHash = null;
    if (!user.emailVerifiedAt) user.emailVerifiedAt = new Date();
    return this.repo.save(user);
  }

  /** 이메일 인증 완료 처리 + 대기 중이던 비밀번호가 있으면 활성화. */
  async markEmailVerified(id: string): Promise<void> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    if (user.pendingPasswordHash) {
      user.passwordHash = user.pendingPasswordHash;
      user.pendingPasswordHash = null;
    }
    if (!user.emailVerifiedAt) user.emailVerifiedAt = new Date();
    await this.repo.save(user);
  }

  async findOrCreateDemoUser(nickname = '데모 여행자'): Promise<UserEntity> {
    const kakaoId = 'demo-user';
    const existing = await this.repo.findOneBy({ kakaoId });
    if (existing) {
      if (existing.nickname !== nickname) {
        existing.nickname = nickname;
        return this.repo.save(existing);
      }
      return existing;
    }

    const user = this.repo.create({
      kakaoId,
      nickname,
      isDemo: true,
    });
    return this.repo.save(user);
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserEntity> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    if (dto.nickname !== undefined) {
      const trimmed = dto.nickname.trim();
      if (!trimmed) {
        throw new BadRequestException('닉네임을 입력해주세요.');
      }
      if (trimmed.length > 20) {
        throw new BadRequestException('닉네임은 20자 이내로 입력해주세요.');
      }
      user.nickname = trimmed;
    }
    if (dto.profileImageUrl !== undefined) {
      user.profileImageUrl = dto.profileImageUrl;
    }
    return this.repo.save(user);
  }

  async updateNotificationPreferences(
    id: string,
    partial: Partial<NotificationPreferencesDto>,
  ): Promise<NotificationPreferencesDto> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    user.notificationPreferences = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      ...(user.notificationPreferences ?? {}),
      ...partial,
    };
    await this.repo.save(user);
    return user.notificationPreferences;
  }

  /** 단일 카테고리 수신 여부 — 미설정이면 default 적용. weather_alert는 replan_ready 토글로 함께 제어. */
  prefersCategory(user: UserEntity, key: keyof NotificationPreferencesDto): boolean {
    const merged: NotificationPreferencesDto = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      ...(user.notificationPreferences ?? {}),
    };
    const effectiveKey = key === 'weather_alert' ? 'replan_ready' : key;
    return merged[effectiveKey] !== false;
  }

  async updateFcmToken(id: string, fcmToken: string): Promise<void> {
    await this.repo.update(id, { fcmToken });
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
    await this.repo.remove(user);
  }
}

function extForMime(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'bin';
}
