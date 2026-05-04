import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PreferenceEntity } from './preference.entity';
import type { UpdatePreferenceDto } from '@tripick/types';

@Injectable()
export class PreferencesService {
  constructor(
    @InjectRepository(PreferenceEntity)
    private readonly repo: Repository<PreferenceEntity>,
  ) {}

  async findByUser(userId: string): Promise<PreferenceEntity | null> {
    return this.repo.findOneBy({ userId });
  }

  async upsert(userId: string, dto: UpdatePreferenceDto): Promise<PreferenceEntity> {
    let pref = await this.repo.findOneBy({ userId });
    if (!pref) {
      pref = this.repo.create({ userId, tasteTags: dto.tasteTags as any });
    } else {
      pref.tasteTags = { ...pref.tasteTags, ...dto.tasteTags } as any;
    }
    return this.repo.save(pref);
  }
}
