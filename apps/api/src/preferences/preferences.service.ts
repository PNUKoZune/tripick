import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PreferenceEntity } from './preference.entity';
import type { PreferenceProfileDto, TasteTagDto, UpdatePreferenceDto } from '@tripick/types';

const EMPTY_TASTE_TAGS: TasteTagDto = {
  food: [],
  mood: [],
  environment: [],
  confidence: 0,
};

const DEFAULT_PROFILE: PreferenceProfileDto = {
  travelStyles: [],
  companions: [],
  sleepTime: '23:00',
  wakeTime: '07:30',
  transportModes: [],
  instagramConnected: false,
  instagramTags: [],
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

  async upsert(
    userId: string,
    dto: UpdatePreferenceDto,
    embeddingId?: string,
  ): Promise<PreferenceEntity> {
    let pref = await this.repo.findOneBy({ userId });
    const incomingTasteTags = dto?.tasteTags ?? {};
    const nextTags: TasteTagDto = {
      food: [...new Set(incomingTasteTags.food ?? pref?.tasteTags.food ?? EMPTY_TASTE_TAGS.food)],
      mood: [...new Set(incomingTasteTags.mood ?? pref?.tasteTags.mood ?? EMPTY_TASTE_TAGS.mood)],
      environment: [
        ...new Set(
          incomingTasteTags.environment ??
            pref?.tasteTags.environment ??
            EMPTY_TASTE_TAGS.environment,
        ),
      ],
      confidence: incomingTasteTags.confidence ?? pref?.tasteTags.confidence ?? 0,
    };

    const nextProfile: PreferenceProfileDto = {
      ...DEFAULT_PROFILE,
      ...(pref?.profile ?? {}),
      ...(dto?.profile ?? {}),
      travelStyles: [...new Set(dto?.profile?.travelStyles ?? pref?.profile?.travelStyles ?? [])],
      companions: [...new Set(dto?.profile?.companions ?? pref?.profile?.companions ?? [])],
      transportModes: [
        ...new Set(dto?.profile?.transportModes ?? pref?.profile?.transportModes ?? []),
      ],
      instagramTags: [
        ...new Set(dto?.profile?.instagramTags ?? pref?.profile?.instagramTags ?? []),
      ],
      instagramConnected:
        dto?.profile?.instagramConnected ??
        pref?.profile?.instagramConnected ??
        DEFAULT_PROFILE.instagramConnected,
      sleepTime: dto?.profile?.sleepTime ?? pref?.profile?.sleepTime ?? DEFAULT_PROFILE.sleepTime,
      wakeTime: dto?.profile?.wakeTime ?? pref?.profile?.wakeTime ?? DEFAULT_PROFILE.wakeTime,
    };

    if (!pref) {
      pref = this.repo.create({ userId, tasteTags: nextTags, profile: nextProfile });
    } else {
      pref.tasteTags = nextTags;
      pref.profile = nextProfile;
    }

    if (embeddingId !== undefined) {
      pref.embeddingId = embeddingId;
    }

    return this.repo.save(pref);
  }
}
