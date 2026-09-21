import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PreferenceEntity } from './preference.entity';
import { PreferenceEmbeddingRepository } from './preference-embedding.repository';
import { buildPreferenceText } from './preference-text';
import { TextEmbeddingService } from '../embedding/text-embedding.service';
import { pruneToPhotos } from './photo-taste';
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
  likedThemes: [],
  dislikedThemes: [],
  pace: 'balanced',
  activityIntensity: 'moderate',
  crowdPreference: 'balanced',
};

@Injectable()
export class PreferencesService {
  private readonly logger = new Logger(PreferencesService.name);

  constructor(
    @InjectRepository(PreferenceEntity)
    private readonly repo: Repository<PreferenceEntity>,
    private readonly embeddings: TextEmbeddingService,
    private readonly preferenceEmbeddings: PreferenceEmbeddingRepository,
  ) {}

  async findByUser(userId: string): Promise<PreferenceEntity | null> {
    return this.repo.findOneBy({ userId });
  }

  /**
   * 취향 사진 URL 목록만 교체한다.
   * 태그가 그대로면 임베딩 텍스트도 그대로라 재임베딩(원격 호출)을 건너뛴다 —
   * 업로드 직후처럼 아직 분석 결과가 없는 시점에 upsert 를 쓰면 임베딩만 헛돈다.
   */
  async setPhotoKeys(userId: string, keys: string[]): Promise<PreferenceEntity> {
    const pref =
      (await this.repo.findOneBy({ userId })) ??
      this.repo.create({
        userId,
        tasteTags: { ...EMPTY_TASTE_TAGS },
        profile: { ...DEFAULT_PROFILE },
        photoTags: {},
      });
    pref.photoKeys = keys;
    // 남지 않은 사진의 분석 결과·비활성 설정은 버린다 — 재집계 대상에서 빠져야 한다.
    pref.photoTags = pruneToPhotos(pref.photoTags ?? {}, keys);
    pref.disabledPhotoTags = pruneToPhotos(pref.disabledPhotoTags ?? {}, keys);
    return this.repo.save(pref);
  }

  /** 검색 개인화용 저장된 취향 벡터 조회 */
  async getPreferenceVector(userId: string): Promise<number[] | null> {
    return this.preferenceEmbeddings.findVectorByUser(userId, this.embeddings.modelId());
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

    // 저장값·입력을 통째로 펼치지 않고 필드마다 명시해 합친다 — 아래에서 모든 필드를
    // 어차피 다시 쓰므로 spread 는 이제 없어진 키(transportModes)만 jsonb 에 남긴다.
    const nextProfile: PreferenceProfileDto = {
      ...DEFAULT_PROFILE,
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

    // 병합 결과로 본다 — 한쪽만 보내도 나머지는 저장값·기본값에서 오므로, 들어온 필드만
    // 검사하면 같은 시각이 저장된다. 이 값은 여행 생성에 그대로 주입돼 trips 가드에 걸리므로,
    // 여기서 막지 않으면 사용자가 원인을 알 수 없는 지점에서 여행 생성이 실패한다.
    if (nextProfile.wakeTime === nextProfile.sleepTime) {
      throw new BadRequestException('기상 시간과 취침 시간은 달라야 합니다.');
    }

    // photoKeys / photoTags / disabledPhotoTags 는 지정된 경우에만 통째로 교체, 아니면 기존 유지
    const nextPhotoKeys = dto?.photoKeys ?? pref?.photoKeys ?? [];
    const nextPhotoTags = dto?.photoTags ?? pref?.photoTags ?? {};
    const nextDisabledPhotoTags = dto?.disabledPhotoTags ?? pref?.disabledPhotoTags ?? {};

    if (!pref) {
      pref = this.repo.create({
        userId,
        tasteTags: nextTags,
        profile: nextProfile,
        photoKeys: nextPhotoKeys,
        photoTags: nextPhotoTags,
        disabledPhotoTags: nextDisabledPhotoTags,
      });
    } else {
      pref.tasteTags = nextTags;
      pref.profile = nextProfile;
      pref.photoKeys = nextPhotoKeys;
      pref.photoTags = nextPhotoTags;
      pref.disabledPhotoTags = nextDisabledPhotoTags;
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
    const result = await this.embeddings.embedWithSource(text);
    // 장애 중 만든 해시 벡터로 마지막 정상 원격 벡터를 덮어쓰면, 서버 복구 뒤에도 서로 다른
    // 공간의 벡터를 비교하게 된다. 취향 원문은 preferences 에 저장하되 벡터는 마지막 정상본 유지.
    if (result.source !== 'remote') {
      this.logger.warn(
        `취향 임베딩 갱신 생략 (user=${userId}): 원격 임베딩 서버가 없어 기존 정상 벡터를 유지합니다.`,
      );
      return '';
    }
    return this.preferenceEmbeddings.upsertUserEmbedding(userId, result.vector, text, {
      modelId: result.modelId,
      source: result.source,
    });
  }
}
