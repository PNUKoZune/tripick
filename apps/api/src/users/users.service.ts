import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from './user.entity';
import type { KakaoProfile, UpdateUserDto } from '@tripick/types';

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
      profileImageUrl: profile.profileImageUrl,
      email: profile.email,
    });
    return this.repo.save(user);
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserEntity> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    Object.assign(user, dto);
    return this.repo.save(user);
  }

  async updateFcmToken(id: string, fcmToken: string): Promise<void> {
    await this.repo.update(id, { fcmToken });
  }
}
