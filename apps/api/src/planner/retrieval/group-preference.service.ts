import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ENVIRONMENT_PREFERENCES,
  FOOD_PREFERENCES,
  MOOD_PREFERENCES,
  type EnvironmentPreference,
  type FoodPreference,
  type MoodPreference,
  type TasteTagDto,
  type TripMemberPreferenceDto,
} from '@tripick/types';
import { PreferencesService } from '../../preferences/preferences.service';
import { TripMemberEntity } from '../../trip-members/trip-member.entity';

export interface GroupPreferenceProfile {
  /** accepted 구성원(계정 없는 수동 동행자 포함) + 누락 시 가상 owner 행. */
  memberCount: number;
  /** 실제 저장 취향 벡터가 있어 공정성 점수 계산에 참여하는 구성원 수. */
  vectorMemberCount: number;
  tasteTags?: TasteTagDto;
  /** 벡터가 없는 수동 동행자까지 포함한 구성원별 태그. tag least-member 점수에 사용한다. */
  memberTasteTags?: TasteTagDto[];
  /** 후보 KNN 검색에 쓰는 L2 정규화 centroid. */
  preferenceVector?: number[];
  /** 후보별 least-member 점수 계산용 개별 벡터. 2명 이상일 때만 제공한다. */
  memberPreferenceVectors?: number[][];
}

interface MemberTaste {
  key: string;
  tasteTags?: TasteTagDto | undefined;
}

/** 차원이 같은 벡터만 평균한 뒤 다시 L2 정규화한다. */
export function normalizedCentroid(vectors: number[][]): number[] | undefined {
  if (vectors.length === 0) return undefined;
  const dimensions = vectors[0]?.length ?? 0;
  if (dimensions === 0 || vectors.some((vector) => vector.length !== dimensions)) return undefined;
  const centroid = Array<number>(dimensions).fill(0);
  for (const vector of vectors) {
    vector.forEach((value, index) => {
      centroid[index] = (centroid[index] ?? 0) + value / vectors.length;
    });
  }
  const norm = Math.sqrt(centroid.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm === 0) return undefined;
  return centroid.map((value) => value / norm);
}

@Injectable()
export class GroupPreferenceService {
  private readonly logger = new Logger(GroupPreferenceService.name);

  constructor(
    @InjectRepository(TripMemberEntity)
    private readonly membersRepo: Repository<TripMemberEntity>,
    private readonly preferences: PreferencesService,
  ) {}

  /** owner와 accepted 동행자의 최신 취향을 그룹 검색 컨텍스트로 만든다. */
  async forTrip(tripId: string, ownerId: string): Promise<GroupPreferenceProfile> {
    const members = (await this.membersRepo.find({
      where: { tripId, status: 'accepted' },
      order: { createdAt: 'ASC' },
    })).filter((member) => member.status === 'accepted');
    const accountIds = [
      ...new Set([ownerId, ...members.flatMap((member) => (member.userId ? [member.userId] : []))]),
    ];
    const [storedPreferences, vectorMap] = await Promise.all([
      this.preferences.findByUsers(accountIds),
      this.preferences.getPreferenceVectors(accountIds),
    ]);
    const preferenceMap = new Map(storedPreferences.map((preference) => [preference.userId, preference]));

    const tastes: MemberTaste[] = [];
    const seen = new Set<string>();
    // owner 멤버 행은 과거 여행에서 없을 수 있다. 최신 preference를 기준으로 항상 한 번 포함한다.
    tastes.push({ key: ownerId, tasteTags: preferenceMap.get(ownerId)?.tasteTags });
    seen.add(ownerId);
    for (const member of members) {
      const key = member.userId ?? `manual:${member.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tastes.push({
        key,
        tasteTags:
          (member.userId ? preferenceMap.get(member.userId)?.tasteTags : undefined) ??
          this.fromMemberPreference(member.preferenceTags),
      });
    }

    const allVectors = accountIds.flatMap((userId) => {
      const vector = vectorMap.get(userId);
      return vector ? [vector] : [];
    });
    const dimensions = this.dominantDimensions(allVectors);
    const compatibleVectors = dimensions
      ? allVectors.filter((vector) => vector.length === dimensions)
      : [];
    if (compatibleVectors.length !== allVectors.length) {
      this.logger.warn(
        `Trip ${tripId}: 그룹 취향 벡터 ${allVectors.length - compatibleVectors.length}개를 차원 불일치로 제외했습니다.`,
      );
    }

    const memberTasteTags = tastes.flatMap((entry) =>
      entry.tasteTags && this.hasTaste(entry.tasteTags) ? [entry.tasteTags] : [],
    );
    const tasteTags = this.mergeTasteTags(memberTasteTags);
    const preferenceVector = normalizedCentroid(compatibleVectors);
    return {
      memberCount: tastes.length,
      vectorMemberCount: compatibleVectors.length,
      ...(tasteTags ? { tasteTags } : {}),
      ...(memberTasteTags.length >= 2 ? { memberTasteTags } : {}),
      ...(preferenceVector ? { preferenceVector } : {}),
      ...(compatibleVectors.length >= 2
        ? { memberPreferenceVectors: compatibleVectors }
        : {}),
    };
  }

  private dominantDimensions(vectors: number[][]): number | undefined {
    const counts = new Map<number, number>();
    for (const vector of vectors) counts.set(vector.length, (counts.get(vector.length) ?? 0) + 1);
    // 동률이면 삽입 순서(항상 owner가 첫 벡터)를 유지한다.
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  }

  private mergeTasteTags(tags: TasteTagDto[]): TasteTagDto | undefined {
    if (tags.length === 0) return undefined;
    const food = new Set<FoodPreference>();
    const mood = new Set<MoodPreference>();
    const environment = new Set<EnvironmentPreference>();
    const foodAllowed = new Set<string>(FOOD_PREFERENCES);
    const moodAllowed = new Set<string>(MOOD_PREFERENCES);
    const environmentAllowed = new Set<string>(ENVIRONMENT_PREFERENCES);
    for (const tag of tags) {
      tag.food.filter((value) => foodAllowed.has(value)).forEach((value) => food.add(value));
      tag.mood.filter((value) => moodAllowed.has(value)).forEach((value) => mood.add(value));
      tag.environment
        .filter((value) => environmentAllowed.has(value))
        .forEach((value) => environment.add(value));
    }
    if (food.size + mood.size + environment.size === 0) return undefined;
    return {
      food: [...food],
      mood: [...mood],
      environment: [...environment],
      confidence: tags.reduce((sum, tag) => sum + tag.confidence, 0) / tags.length,
    };
  }

  private hasTaste(tags: TasteTagDto): boolean {
    return tags.food.length + tags.mood.length + tags.environment.length > 0;
  }

  private fromMemberPreference(preference?: TripMemberPreferenceDto): TasteTagDto | undefined {
    if (!preference) return undefined;
    return {
      food: preference.food.filter((value): value is FoodPreference =>
        (FOOD_PREFERENCES as readonly string[]).includes(value),
      ),
      mood: preference.mood.filter((value): value is MoodPreference =>
        (MOOD_PREFERENCES as readonly string[]).includes(value),
      ),
      environment: preference.environment.filter((value): value is EnvironmentPreference =>
        (ENVIRONMENT_PREFERENCES as readonly string[]).includes(value),
      ),
      // 수동 멤버가 직접 고른 태그는 분석 불확실성이 없는 명시 입력이다.
      confidence: 1,
    };
  }
}
