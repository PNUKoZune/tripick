import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PreferenceEntity } from './preference.entity';
import type { TasteTagDto, UpdatePreferenceDto } from '@tripick/types';

const EMPTY_TASTE_TAGS: TasteTagDto = {
  food: [],
  mood: [],
  environment: [],
  confidence: 0,
};

@Injectable()
export class PreferencesService {
  constructor(
    @InjectRepository(PreferenceEntity)
    private readonly repo: Repository<PreferenceEntity>,
  ) {}

  async findByUser(userId: string): Promise<PreferenceEntity | null> {
    return this.repo.findOneBy({ userId });
  }

  async upsert(userId: string, dto: UpdatePreferenceDto, embeddingId?: string): Promise<PreferenceEntity> {
    let pref = await this.repo.findOneBy({ userId });
    const incomingTasteTags = dto?.tasteTags ?? {};
    const nextTags: TasteTagDto = {
      food: [...new Set(incomingTasteTags.food ?? pref?.tasteTags.food ?? EMPTY_TASTE_TAGS.food)],
      mood: [...new Set(incomingTasteTags.mood ?? pref?.tasteTags.mood ?? EMPTY_TASTE_TAGS.mood)],
      environment: [
        ...new Set(incomingTasteTags.environment ?? pref?.tasteTags.environment ?? EMPTY_TASTE_TAGS.environment),
      ],
      confidence: incomingTasteTags.confidence ?? pref?.tasteTags.confidence ?? 0,
    };

    if (!pref) {
      pref = this.repo.create({ userId, tasteTags: nextTags });
    } else {
      pref.tasteTags = nextTags;
    }

    if (embeddingId !== undefined) {
      pref.embeddingId = embeddingId;
    }

    return this.repo.save(pref);
  }
}
