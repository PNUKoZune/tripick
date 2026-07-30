import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FOOD_PREFERENCES,
  type Coordinates,
  type EnvironmentPreference,
  type MoodPreference,
  type ReplanTrigger,
} from '@tripick/types';
import { inferPlaceTags, normalizeDestinationRegion, tasteTagsToKeywords } from './place-seeds';
import { collapseNearDuplicates } from './near-duplicate';
import { NEUTRAL_POPULARITY } from './naver-search.service';
import { isClosedAt } from './opening-hours.parser';
import { DEFAULT_RETRIEVAL_WEIGHT, termWeights, type TermWeights } from './retrieval-rank';
import type { CandidatePlace, CragScore, RawPlaceCandidate, RetrievalContext } from './types';

/**
 * mood·environment 태그의 실내 여부. 비(날씨) 재계획에서 실내 후보를 우대할 때 쓴다.
 *
 * `Record<MoodPreference | EnvironmentPreference, …>` 인 것이 핵심 — 예전엔 실내 태그만 골라
 * 담은 배열이라 어휘에 값이 늘면 **조용히 실외로 취급**됐다(hotspring·nightview 를 추가했을 때
 * 실제로 그랬다). 이제 어휘에 값을 더하면 여기서 컴파일 에러가 난다.
 * 식음(FOOD 전체)은 실내가 정의상 자명해 아래에서 어휘째 파생한다.
 */
const INDOOR_BY_TASTE_TAG: Record<MoodPreference | EnvironmentPreference, boolean> = {
  // mood
  healing: false, // 숲·해변 힐링이 다수 — 스파는 hotspring 이 잡는다
  adventure: false,
  romantic: false,
  family: true, // 박물관·체험관 등 실내 가족 시설
  cultural: true, // 전시·박물관
  nostalgic: false, // 시장·골목이 다수
  trendy: true, // 편집숍·소품샵
  luxury: true, // 호텔·오마카세
  // environment
  nature: false,
  city: true, // 도심 실내 시설
  beach: false,
  mountain: false,
  village: false,
  lake: false,
  island: false,
  hotspring: true,
  nightview: false,
};

const INDOOR_TAGS = new Set<string>([
  ...FOOD_PREFERENCES,
  ...Object.entries(INDOOR_BY_TASTE_TAG)
    .filter(([, indoor]) => indoor)
    .map(([tag]) => tag),
]);

/** 후보 풀 구성을 보장할 때 쓰는 종류 묶음 (식음 / 볼거리). */
const DINING_CATEGORIES: ReadonlySet<string> = new Set(['restaurant', 'cafe']);
const ATTRACTION_CATEGORIES: ReadonlySet<string> = new Set(['attraction']);

/** 트리거 없음(최초 생성) 및 트리거별 선호 신호가 없을 때 쓰는 중립 점수. */
const NEUTRAL_TRIGGER_SCORE = 0.64;

/**
 * 트리거별 후보 선호도. `Record<ReplanTrigger, …>` 라 ReplanTrigger 에 값이 늘면 여기서
 * 컴파일 에러로 잡힌다 — if 체인 시절엔 새 트리거가 조용히 기본값으로 떨어졌다(crowd 가 그랬다).
 * 점수 신호가 없는 트리거는 중립값을 명시적으로 둔다(후보 조향은 kakao-local 키워드가 맡는다).
 */
const TRIGGER_SCORE: Record<ReplanTrigger, (tags: string[]) => number> = {
  // 비 예보 대응 — 실내 후보 우대.
  weather: (tags) => (tags.some((tag) => INDOOR_TAGS.has(tag)) ? 0.9 : 0.42),
  // 미도착 대응 — 복귀 동선을 짜야 해서 후보 전반을 살짝 우대.
  deviation: () => 0.72,
  // 혼잡 대응 — "붐비지 않음"을 판단할 후보 단위 신호가 없어 중립. 조향은 검색 키워드로.
  crowd: () => NEUTRAL_TRIGGER_SCORE,
  manual: () => NEUTRAL_TRIGGER_SCORE,
};

@Injectable()
export class CragEvaluatorService {
  constructor(@Optional() private readonly config?: ConfigService) {}

  rank(candidates: RawPlaceCandidate[], context: RetrievalContext): CandidatePlace[] {
    const weights = this.weights();
    const scored = this.deduplicate(candidates)
      .map((candidate) => this.evaluate(candidate, context, weights))
      .sort((a, b) => b.confidence - a.confidence);
    // 근접 중복 접기는 **점수 정렬 뒤에** 온다 — 남는 대표가 그 무리에서 가장 높은 후보여야 한다.
    return collapseNearDuplicates(scored, context.destination);
  }

  /**
   * 실효 가중치. `CRAG_RETRIEVAL_WEIGHT` 로 retrieval 항만 조정하고 남은 몫은 비례 배분해
   * 합 1 을 지킨다(=confidence 의 절대 의미 유지). accept 게이트도 이 값을 봐야 한다.
   */
  weights(): TermWeights {
    return termWeights(this.readWeight('CRAG_RETRIEVAL_WEIGHT', DEFAULT_RETRIEVAL_WEIGHT));
  }

  private readWeight(key: string, fallback: number): number {
    const raw = this.config?.get<string>(key);
    // 빈 문자열·미설정은 Number('') === 0 이라 조용히 0 가중이 되므로 명시적으로 걸러낸다.
    if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  }

  /** 후보 풀이 반드시 담아야 하는 종류별 최소 수. 일정에 식사 슬롯과 볼거리가 둘 다 필요하다. */
  private static readonly POOL_MIN_PER_KIND = 2;

  /**
   * 점수 순으로 후보를 고르되, 종류별 최소 보유량을 보장한다.
   *
   * ⚠️ 예전 구현은 **상위 6칸을 카테고리당 2개로 제한**했는데 두 가지가 잘못이었다.
   *   1. 상한에 걸린 후보를 건너뛴 채 limit 을 채우고 반환해 **후보를 영구히 버렸다**
   *      (백필 루프가 실행될 일이 없었다). 제주 실측에서 점수 3위 한라산·5위 비자림이
   *      탈락하고 점수가 더 낮은 카페·리조트가 그 자리에 들어왔다.
   *   2. 제약을 머리에 걸어서, 자연·문화 취향 질의인데도 상위 6칸 중 4칸이 카페·식당으로
   *      채워지고 정답이 7위 밖으로 밀렸다.
   *
   * 필요한 건 "상위가 다양해야 한다"가 아니라 **"풀에 종류가 둘 다 있어야 한다"** 다 — 플래너는
   * 16개 후보를 받아 식사 슬롯과 관광 슬롯을 채우므로, 순서보다 구성이 중요하다. 그래서 머리는
   * 점수 순 그대로 두고, 부족한 종류만 꼬리 자리를 내주고 채운다.
   */
  selectTopDiverse(candidates: CandidatePlace[], limit: number): CandidatePlace[] {
    const selected = candidates.slice(0, limit);
    if (selected.length < limit) return selected;

    for (const kind of [DINING_CATEGORIES, ATTRACTION_CATEGORIES]) {
      const have = selected.filter((candidate) => kind.has(candidate.category)).length;
      const missing = CragEvaluatorService.POOL_MIN_PER_KIND - have;
      if (missing <= 0) continue;

      const chosen = new Set(selected.map((candidate) => candidate.id));
      const fills = candidates
        .filter((candidate) => kind.has(candidate.category) && !chosen.has(candidate.id))
        .slice(0, missing);

      // 내줄 자리는 **과잉 종류의 꼬리**부터 — 최소 보유량을 지키는 종류를 깎으면 안 된다.
      for (const fill of fills) {
        const dropIndex = this.lastReplaceableIndex(selected, kind);
        if (dropIndex < 0) break;
        selected.splice(dropIndex, 1, fill);
      }
    }

    return selected;
  }

  /**
   * 교체해 내줄 수 있는 마지막 자리. 채우려는 종류가 아니고, 그 종류를 빼도 최소 보유량이
   * 깨지지 않는 후보 중 가장 뒤에 있는 것.
   */
  private lastReplaceableIndex(
    selected: CandidatePlace[],
    filling: ReadonlySet<string>,
  ): number {
    for (let i = selected.length - 1; i >= 0; i -= 1) {
      const candidate = selected[i]!;
      if (filling.has(candidate.category)) continue;
      const kind = DINING_CATEGORIES.has(candidate.category)
        ? DINING_CATEGORIES
        : ATTRACTION_CATEGORIES;
      const have = selected.filter((item) => kind.has(item.category)).length;
      if (have <= CragEvaluatorService.POOL_MIN_PER_KIND) continue;
      return i;
    }
    return -1;
  }

  private evaluate(
    candidate: RawPlaceCandidate,
    context: RetrievalContext,
    weights: TermWeights,
  ): CandidatePlace {
    const tags = candidate.tags?.length ? candidate.tags : inferPlaceTags(candidate);
    const matchedTags = this.matchedTags(tags, context);
    const penalties: string[] = [];
    const retrieval = this.retrievalScore(candidate);
    const personalization = this.personalizationScore(candidate);
    const taste = this.tasteScore(tags, context, personalization);
    const locality = this.localityScore(candidate, context, penalties);
    const contextScore = this.contextScore(candidate, tags, context);
    const availability = this.availabilityScore(candidate, context, penalties);
    const popularity = this.popularityScore(candidate, context, penalties);
    // 네이버 인지도 항을 더해 마이너 장소를 후순위로 민다.
    // 인덱스 비활성 시 popularity=중립값이라 나머지 항 비율만 유지되고 순위는 불변.
    const total = this.clamp(
      retrieval * weights.retrieval +
        taste * weights.taste +
        popularity * weights.popularity +
        locality * weights.locality +
        contextScore * weights.context +
        availability * weights.availability,
    );

    const crag: CragScore = {
      total,
      retrieval,
      taste,
      locality,
      context: contextScore,
      availability,
      popularity,
      matchedTags,
      penalties,
      ...(personalization !== undefined ? { personalization } : {}),
    };

    return {
      ...candidate,
      tags,
      confidence: Number(total.toFixed(3)),
      reason: this.reason(candidate, crag, context),
      crag,
    };
  }

  private retrievalScore(candidate: RawPlaceCandidate): number {
    if (candidate.similarity !== undefined) {
      return this.clamp((candidate.similarity + 1) / 2);
    }
    if (candidate.source === 'kakao') return 0.66;
    return 0.58;
  }

  private tasteScore(
    tags: string[],
    context: RetrievalContext,
    personalization?: number,
  ): number {
    const neutralScore = 0.56;
    const preferred = tasteTagsToKeywords(context.tasteTags);
    const rawTagScore =
      preferred.length === 0
        ? neutralScore
        : this.clamp(0.35 + preferred.filter((tag) => tags.includes(tag)).length / preferred.length);
    const rawConfidence = context.tasteTags?.confidence ?? 0;
    const tasteConfidence = Number.isFinite(rawConfidence) ? this.clamp(rawConfidence) : 0;
    // 사진 분석 confidence 만큼만 태그 매칭 점수를 중립값에서 움직인다.
    const tagScore = neutralScore + (rawTagScore - neutralScore) * tasteConfidence;
    // 취향 벡터 유사도가 있으면 태그 매칭보다 우선해 리랭킹 (벡터 기반 개인화)
    if (personalization === undefined) return tagScore;
    return this.clamp(tagScore * 0.45 + personalization * 0.55);
  }

  /**
   * 네이버 추천 글 대중 인지도 점수. 인덱스가 없으면 중립값이라 순위에 영향 없음.
   * 언급 0(마이너 장소)이면 낮은 점수 → 소프트 감점, 제거는 아니다.
   */
  private popularityScore(
    candidate: RawPlaceCandidate,
    context: RetrievalContext,
    penalties: string[],
  ): number {
    const index = context.popularityIndex;
    if (!index || index.docCount === 0) return NEUTRAL_POPULARITY;
    const score = index.score(candidate.name);
    if (index.mentions(candidate.name) === 0) penalties.push('naver-unmentioned');
    return score;
  }

  /** 저장된 취향 벡터와의 코사인 유사도(-1~1)를 0~1 점수로 정규화 */
  private personalizationScore(candidate: RawPlaceCandidate): number | undefined {
    if (candidate.preferenceSimilarity === undefined) return undefined;
    return this.clamp((candidate.preferenceSimilarity + 1) / 2);
  }

  private localityScore(
    candidate: RawPlaceCandidate,
    context: RetrievalContext,
    penalties: string[],
  ): number {
    const region = normalizeDestinationRegion(context.destination);
    if (region === 'default') return 0.62;
    const haystack = `${candidate.name} ${candidate.address} ${candidate.destinationRegion ?? ''}`.toLowerCase();
    const regionMatches =
      candidate.destinationRegion?.toLowerCase() === region ||
      this.regionKeywords(region).some((keyword) => haystack.includes(keyword));
    if (regionMatches) return 0.92;
    penalties.push('destination-mismatch');
    return 0.32;
  }

  private contextScore(
    candidate: RawPlaceCandidate,
    tags: string[],
    context: RetrievalContext,
  ): number {
    const triggerScore = this.triggerScore(candidate, tags, context);
    const distanceScore = context.currentLocation
      ? this.distanceScore(candidate.coordinates, context.currentLocation)
      : 0.62;
    return this.clamp(triggerScore * 0.65 + distanceScore * 0.35);
  }

  private triggerScore(
    candidate: RawPlaceCandidate,
    tags: string[],
    context: RetrievalContext,
  ): number {
    if (!context.trigger) return NEUTRAL_TRIGGER_SCORE;
    return TRIGGER_SCORE[context.trigger](tags);
  }

  /**
   * 영업시간 판정. **감점 전용이다** — 판정 불가(데이터 없음·형식 불명·방문 시각 없음)와
   * "열려 있음 확인"이 같은 값이고, 확인된 닫힘만 깎는다.
   *
   * 예전엔 열림 0.95 / 판정 불가 0.58 로 갈라 **영업시간 데이터가 있다는 사실 자체에 총점 0.041**
   * 을 얹고 있었다(가중 0.111 × 0.37). popularity 의 '언급 0' 감점 영향폭(0.052)에 맞먹는
   * 크기인데, 장소 품질이 아니라 **데이터 출처**에 붙는 가점이었다.
   *
   * 그 출처가 카테고리와 얽혀 있다는 게 문제다. 영업시간은 KTO 출처(4,501행)만 얻을 수 있고
   * 카카오 전용(5,980행)은 [구글 Places 미채택](../../../../docs/plans/2026-07-21-open-backlog.md)
   * 이후 영구히 못 얻는데, **카페는 전원 카카오 출처다** — 카탈로그 실측 가점률이
   * 식당 199/2,548(7.8%) · 관광지 345/6,615(5.2%) · **카페 0/1,312(0%)** 였다. 즉 카페만
   * 구조적으로 가점에서 배제된다. 일정에는 카페 슬롯도 필요하다(`selectTopDiverse` 가 식음
   * 최소 보유량을 보장하는 이유).
   *
   * 중립값이 예전 다수값 0.58 그대로인 것도 의도다 — 후보 95%가 이 값이라, 여기를 올리면 순위는
   * 그대로인데 confidence 절대 수준이 통째로 올라가 accept 게이트(`CRAG_MIN_CONFIDENCE`)와
   * 폴백 판정(`CRAG_TARGET_CONFIDENCE`)이 함께 움직인다.
   *
   * 영업시간 밖 일정을 실제로 막는 것은 이 항(총점 차이 0.037)이 아니라
   * [ConstraintEngine.checkOpeningHours](../constraint/constraint.engine.ts) 의 하드 검증이다.
   * 역할이 다르다 — 점수는 "가능하면 안 뽑기", 제약은 "뽑혔으면 막기".
   */
  private availabilityScore(
    candidate: RawPlaceCandidate,
    context: RetrievalContext,
    penalties: string[],
  ): number {
    const neutral = 0.58;
    if (!context.startAt) return neutral;
    // 판정은 평가 하네스와 공유한다 — 규칙이 두 곳에 있으면 지표가 감점 대상을 못 따라간다.
    if (!isClosedAt(candidate.openingHours, context.startAt)) return neutral;
    penalties.push('closed-at-target-time');
    return 0.25;
  }

  private distanceScore(from: Coordinates, to: Coordinates): number {
    const km = this.distanceKm(from, to);
    if (km <= 0.5) return 0.95;
    if (km <= 2) return 0.82;
    if (km <= 5) return 0.62;
    if (km <= 12) return 0.42;
    return 0.25;
  }

  private matchedTags(tags: string[], context: RetrievalContext): string[] {
    const preferred = new Set(tasteTagsToKeywords(context.tasteTags));
    return tags.filter((tag) => preferred.has(tag));
  }

  private reason(candidate: RawPlaceCandidate, score: CragScore, context: RetrievalContext): string {
    const matched = score.matchedTags.length > 0
      ? `선호 태그 ${score.matchedTags.join(', ')} 일치`
      : `${context.destination} 동선 후보`;
    const confidence = Math.round(score.total * 100);
    const sourceLabel = {
      pgvector: 'pgvector',
      kakao: 'Kakao Local',
      seed: 'seed fallback',
    }[candidate.source];
    const fallback = candidate.source === 'pgvector' ? '' : ', 검색 보정 fallback 반영';
    const personalized =
      score.personalization !== undefined && score.personalization >= 0.6
        ? `, 취향 벡터 ${Math.round(score.personalization * 100)}% 부합`
        : '';
    // NEUTRAL_POPULARITY(0.5) 초과는 네이버 추천 글에 실제 언급된 장소를 뜻한다.
    const popular = score.popularity > NEUTRAL_POPULARITY ? ', 네이버 추천 글 다수 언급' : '';
    return `${matched}, ${sourceLabel} confidence ${confidence}%${personalized}${popular}${fallback}`;
  }

  /** ID·이름+주소 완전일치 중복 제거. 근접 중복은 점수 정렬 뒤 `collapseNearDuplicates` 가 맡는다. */
  private deduplicate(candidates: RawPlaceCandidate[]): RawPlaceCandidate[] {
    const seen = new Set<string>();
    const unique: RawPlaceCandidate[] = [];
    for (const candidate of candidates) {
      const key = candidate.kakaoPlaceId ?? `${candidate.name}:${candidate.address}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(candidate);
    }
    return unique;
  }

  private regionKeywords(region: string): string[] {
    return {
      seoul: ['서울', 'seoul'],
      busan: ['부산', 'busan'],
      jeju: ['제주', 'jeju'],
      gyeongju: ['경주', 'gyeongju'],
      default: [],
    }[region] ?? [];
  }

  private distanceKm(from: Coordinates, to: Coordinates): number {
    const latDelta = (from.lat - to.lat) * 111;
    const lngDelta = (from.lng - to.lng) * 88;
    return Math.sqrt(latDelta ** 2 + lngDelta ** 2);
  }

  private clamp(value: number): number {
    return Math.max(0, Math.min(1, value));
  }
}
