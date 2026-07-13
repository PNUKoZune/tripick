import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PreferenceEntity } from './preference.entity';
import { PreferenceEmbeddingRepository } from './preference-embedding.repository';
import { buildPreferenceText } from './preference-text';
import { TextEmbeddingService } from '../embedding/text-embedding.service';
import type { PreferenceProfileDto, TasteTagDto, UpdatePreferenceDto } from '@tripick/types';

const EMPTY_TASTE_TAGS: TasteTagDto = {
  food: [],
  mood: [],
  environment: [],
  confidence: 0,
};

const DEFAULT_PROFILE: PreferenceProfileDto = {
  sleepTime: '23:00',
  wakeTime: '07:30',
  transportModes: [],
  likedThemes: [],
  dislikedThemes: [],
  pace: 'balanced',
  activityIntensity: 'moderate',
  crowdPreference: 'balanced',
};

@Injectable()
export class PreferencesService {
  constructor(
    @InjectRepository(PreferenceEntity)
    private readonly repo: Repository<PreferenceEntity>,
    private readonly embeddings: TextEmbeddingService,
    private readonly preferenceEmbeddings: PreferenceEmbeddingRepository,
  ) {}

  async findByUser(userId: string): Promise<PreferenceEntity | null> {
    return this.repo.findOneBy({ userId });
  }

  /** 검색 개인화용 저장된 취향 벡터 조회 */
  async getPreferenceVector(userId: string): Promise<number[] | null> {
    return this.preferenceEmbeddings.findVectorByUser(userId);
  }

  async upsert(userId: string, dto: UpdatePreferenceDto): Promise<PreferenceEntity> {
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
      transportModes: [
        ...new Set(dto?.profile?.transportModes ?? pref?.profile?.transportModes ?? []),
      ],
      likedThemes: [...new Set(dto?.profile?.likedThemes ?? pref?.profile?.likedThemes ?? [])],
      dislikedThemes: [
        ...new Set(dto?.profile?.dislikedThemes ?? pref?.profile?.dislikedThemes ?? []),
      ],
      pace: dto?.profile?.pace ?? pref?.profile?.pace ?? DEFAULT_PROFILE.pace,
      activityIntensity:
        dto?.profile?.activityIntensity ??
        pref?.profile?.activityIntensity ??
        DEFAULT_PROFILE.activityIntensity,
      crowdPreference:
        dto?.profile?.crowdPreference ??
        pref?.profile?.crowdPreference ??
        DEFAULT_PROFILE.crowdPreference,
      sleepTime: dto?.profile?.sleepTime ?? pref?.profile?.sleepTime ?? DEFAULT_PROFILE.sleepTime,
      wakeTime: dto?.profile?.wakeTime ?? pref?.profile?.wakeTime ?? DEFAULT_PROFILE.wakeTime,
    };

    // photoUrls 는 지정된 경우에만 통째로 교체, 아니면 기존 유지
    const nextPhotoUrls = dto?.photoUrls ?? pref?.photoUrls ?? [];

    if (!pref) {
      pref = this.repo.create({
        userId,
        tasteTags: nextTags,
        profile: nextProfile,
        photoUrls: nextPhotoUrls,
      });
    } else {
      pref.tasteTags = nextTags;
      pref.profile = nextProfile;
      pref.photoUrls = nextPhotoUrls;
    }

    // 취향 태그 + 프로필을 임베딩해 preference_embeddings 에 유저당 1행으로 저장 → 검색 개인화 루프
    const embeddingId = await this.syncEmbedding(userId, nextTags, nextProfile);
    if (embeddingId) {
      pref.embeddingId = embeddingId;
    }

    return this.repo.save(pref);
  }

  private async syncEmbedding(
    userId: string,
    tasteTags: TasteTagDto,
    profile: PreferenceProfileDto,
  ): Promise<string> {
    const text = buildPreferenceText(tasteTags, profile);
    // 취향 신호가 없으면 제네릭 벡터를 저장하지 않는다 (개인화 편향 방지)
    if (!text.trim()) return '';
    const vector = await this.embeddings.embed(text);
    return this.preferenceEmbeddings.upsertUserEmbedding(userId, vector, text);
  }
}
