import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from './user.entity';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type KakaoProfile,
  type NotificationPreferencesDto,
  type UpdateUserDto,
} from '@tripick/types';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly repo: Repository<UserEntity>,
  ) {}

  async findById(id: string): Promise<UserEntity | null> {
    return this.repo.findOneBy({ id });
  }

  async findOrCreateByKakao(profile: KakaoProfile): Promise<UserEntity> {
    const existing = await this.repo.findOneBy({ kakaoId: profile.id });
    if (existing) return existing;

    const user = this.repo.create({
      kakaoId: profile.id,
      nickname: profile.nickname,
    });

    if (profile.profileImageUrl !== undefined) {
      user.profileImageUrl = profile.profileImageUrl;
    }
    if (profile.email !== undefined) {
      user.email = profile.email;
    }

    return this.repo.save(user);
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

  async remove(id: string): Promise<void> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    await this.repo.remove(user);
  }
}
