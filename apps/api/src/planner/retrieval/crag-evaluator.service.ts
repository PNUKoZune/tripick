import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FOOD_PREFERENCES,
  type Coordinates,
  type EnvironmentPreference,
  type MoodPreference,
  type ReplanTrigger,
} from '@tripick/types';
import { inferPlaceTags, tasteTagsToKeywords } from './place-seeds';
import {
  destinationRegionFilter,
  matchesRegionFilter,
  placeRegionCodes,
  type RegionFilter,
} from './region-code';
import { collapseNearDuplicates } from './near-duplicate';
import { NEUTRAL_POPULARITY } from './naver-search.service';
import { isClosedAt } from './opening-hours.parser';
import { DEFAULT_RETRIEVAL_WEIGHT, termWeights, type TermWeights } from './retrieval-rank';
import type {
  CandidatePlace,
  CragScore,
  PoolCategoryQuota,
  RawPlaceCandidate,
  RetrievalContext,
} from './types';

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
/**
 * 후보 풀에서 식음(음식점·카페)이 차지할 수 있는 최대 비율. 골든셋 스윕으로 잡았다.
 *
 * | 비율 | 희소 카탈로그 R\|cat | 조밀 카탈로그 R\|cat |
 * | --- | --- | --- |
 * | 1 (상한 없음) | 0.471 | 0.439 |
 * | 0.5 | 0.471 | 0.444 |
 * | **0.375** | **0.475** | **0.458** |
 * | 0.25 | 0.475 | 0.463 |
 *
 * 희소 카탈로그에서 움직이는 케이스는 `daegu-nostalgic` **하나뿐이고(0.23 → 0.31)**
 * 나빠지는 케이스가 없다. 0.25 가 조밀 카탈로그에서 조금 더 좋지만 **안 쓴다** — 풀 크기가
 * `일정 항목 수 + 4` 라 3일 여행이면 limit 19 이고, 0.25 는 식음 후보 4개로 6끼를 채워야 한다.
 * 골든셋 정답에는 식당이 거의 없어 지표는 언제나 식음을 줄이는 쪽을 가리키므로, 여기서만은
 * 지표가 아니라 일정이 실제로 필요로 하는 슬롯 수를 따른다.
 */
const DEFAULT_MAX_DINING_RATIO = 0.375;
const DINING_CATEGORIES: ReadonlySet<string> = new Set(['restaurant', 'cafe']);
const ATTRACTION_CATEGORIES: ReadonlySet<string> = new Set(['attraction']);

const DEFAULT_POOL_QUOTA: PoolCategoryQuota = { restaurant: 2, cafe: 1, attraction: 2 };

/** 트리거 없음(최초 생성) 및 트리거별 선호 신호가 없을 때 쓰는 중립 점수. */
const NEUTRAL_TRIGGER_SCORE = 0.64;

/**
 * `inferPlaceTags` 의 폴백 태그. 이것들만 있으면 사전이 이름에서 아무것도 못 읽은 것이다
 * — `cultural` 은 category==='attraction' 이면 무조건 붙고, `city` 는 태그 0 일 때의 폴백이다.
 */
const FALLBACK_ONLY_TAGS: ReadonlySet<string> = new Set(['cultural', 'city']);

/** 후보 풀 단위 판정 결과. 가를 수 없는 항은 꺼서 일률 감점이 순위를 흔드는 걸 막는다. */
interface PoolJudgement {
  region: boolean;
  popularity: boolean;
}

/**
 * 인지도 항을 켤 최소 언급 비율. 후보 풀에서 이만큼도 안 잡히면 코퍼스가 그 지역을 못 담은 것으로 본다.
 *
 * 골든셋 스윕(14케이스)으로 정했다:
 *
 * | 임계 | R@10 | R\|cat | MRR | 비고 |
 * |---|---|---|---|---|
 * | 0 (항상 켬) | 0.334 | 0.624 | 0.673 | 대구가 0점 |
 * | **0.03~0.12** | **0.342** | **0.631** | **0.682** | 평평한 최적 |
 * | 0.16 | 0.334 | 0.607 | 0.688 | 부산·제주(12~13%)가 꺼져 손해 |
 * | 0.25 | 0.206 | 0.486 | 0.429 | 급락 |
 * | 1 (항상 끔) | 0.163 | 0.364 | 0.345 | 폭락 |
 *
 * ⚠️ **인지도를 끄는 게 목적이 아니다.** 항상 끄면(1) 지표가 절반으로 무너진다 — 언급 0 감점은
 * 전체적으로 크게 이득이고, 코퍼스가 그 지역을 담아낸 경우에만 그렇다는 게 이 게이트의 요지다.
 *
 * 0.03~0.12 가 동률이라 **의도로 갈랐다**: 대구(1.3%)만 끄고 서울(6.0%)은 살린다.
 * 서울은 400건 중 24건이 실제로 언급된 것이라 신호로 볼 여지가 있다. 0.05 는 그 사이에서
 * 양쪽 모두와 여유를 두는 값이다.
 */
const DEFAULT_MIN_POPULARITY_COVERAGE = 0.05;

/**
 * 태그가 폴백뿐인 후보의 취향 점수를 중립으로 둘지.
 *
 * 골든셋 16케이스 연속 A/B (전국 적재 · 커버리지 97% 상태):
 *
 * | | R@5 | R@10 | R\|cat | MRR |
 * |---|---|---|---|---|
 * | 끔 | 0.234 | 0.429 | 0.530 | 0.700 |
 * | **켬** | 0.226 | **0.431** | **0.537** | **0.723** |
 *
 * 케이스별 `R|cat` 은 개선 3 / 악화 1 / 무변화 12 다 — 진단이 지목한 케이스가 정확히 올랐다:
 * 부산 0.46→**0.54**(오륙도·송도해상케이블카), 속초 0.50→**0.60**(신흥사·영금정), 경주 0.80→0.90.
 *
 * ⚠️ **커버리지가 채워진 뒤에야 이득이 됐다.** 커버리지 74% 시절 같은 변경은 개선 5 / 악화 5 로
 * 갈려 채택하지 않았다(그때 기록: `retrieval-eval-harness-hardening-v1.md` §4.2). 후보 풀이 얇을
 * 때는 중립화가 빈 자리를 엉뚱한 후보로 채웠고, 풀이 두꺼워지자 제자리를 찾았다.
 *
 * ⚠️ 트레이드오프 하나 — `cultural` 을 폴백으로 보므로 **문화 취향 케이스는 손해**다
 * (gyeongju-weather-indoor R\|cat 0.50→0.33). 실제 문화시설이 `cultural` 하나만 갖고 있으면
 * 중립이 되어 가점을 못 받는다. 3케이스 개선(+0.28)이 1케이스 악화(-0.17)보다 커서 채택했다.
 * `cultural` 을 폴백에서 빼면 이 손해는 사라지지만 신흥사·영금정이 다시 감점된다.
 */
const DEFAULT_TASTE_FALLBACK_NEUTRAL = true;

/**
 * 앵커 반경 경계의 locality 점수 = **거리 항의 세기**. 0.95 는 사실상 끈 것(전 후보 동점)이고,
 * 낮출수록 앵커 가까운 쪽을 강하게 우대한다.
 *
 * 앵커 케이스 2개(광안리·서면역) 스윕:
 *
 * | edge | R@10 | R\|cat | 비고 |
 * |---|---|---|---|
 * | 0.95 (끔) | 0.364 | 0.540 | 기준선 — 광안리 2위가 센텀시티 스파랜드(2km 밖) |
 * | 0.85 | 0.409 | 0.540 | |
 * | **0.7** | **0.455** | **0.540** | 무릎 |
 * | 0.6 이하 | 0.455 | 0.495 | 거리가 과해져 정답 하나가 상위 16 밖으로 밀림 |
 *
 * 0.6 부터 R\|cat 이 깎이는 게 상한 신호다 — R@10 이 같아도 정답을 잃고 있다.
 */
const DEFAULT_ANCHOR_EDGE_SCORE = 0.7;

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
    const unique = this.deduplicate(candidates);
    // 앵커로 해석된 목적지는 그 결과가 정본이다 — 여기서 destination 문자열을 다시 파싱하면
    // '광안리' 가 존재하지 않는 시군구 코드로 되돌아가 지역 가드가 통째로 꺼진다.
    const expectedRegion = context.regionFilter ?? destinationRegionFilter(context.destination);
    const judgement: PoolJudgement = {
      region: this.localityJudgeable(unique, expectedRegion),
      popularity: this.popularityJudgeable(unique, context),
    };
    const scored = unique
      .map((candidate) => this.evaluate(candidate, context, weights, expectedRegion, judgement))
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

  /** 지역 판정 불가(목적지·후보 어느 쪽이든) 시 쓰는 중립값. */
  private static readonly NEUTRAL_LOCALITY = 0.62;

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
  selectTopDiverse(
    candidates: CandidatePlace[],
    limit: number,
    quota: PoolCategoryQuota = DEFAULT_POOL_QUOTA,
  ): CandidatePlace[] {
    const selected = candidates.slice(0, limit);
    if (selected.length < limit) return selected;

    const minimums = this.resolveMinimums(quota, limit);
    this.ensureCategoryMinimums(selected, candidates, minimums);
    this.capDiningShare(selected, candidates, minimums);
    return selected;
  }

  /**
   * 하한을 확정한다. 합이 풀 크기를 넘으면 비율대로 눌러 담되 각 종류에 최소 1자리는 남긴다
   * (실사용 조합에서는 넘칠 일이 없고, 짧은 여행·작은 limit 의 안전장치다).
   */
  private resolveMinimums(quota: PoolCategoryQuota, limit: number): Map<string, number> {
    const raw: Array<[string, number]> = [
      ['restaurant', Math.max(0, Math.floor(quota.restaurant))],
      ['cafe', Math.max(0, Math.floor(quota.cafe))],
      ['attraction', Math.max(0, Math.floor(quota.attraction))],
    ];
    const total = raw.reduce((sum, [, value]) => sum + value, 0);
    if (total <= limit) return new Map(raw);

    const scale = limit / total;
    return new Map(
      raw.map(([category, value]) => [
        category,
        value > 0 ? Math.max(1, Math.floor(value * scale)) : 0,
      ]),
    );
  }

  /**
   * 종류별 하한을 채운다. **희소한 종류부터** 채우는 것이 핵심 — 카탈로그가 관광지 27,436 :
   * 음식점 15,854 : 카페 2,591 이라, 카페를 뒤로 미루면 내줄 자리가 남지 않는다.
   */
  private ensureCategoryMinimums(
    selected: CandidatePlace[],
    candidates: CandidatePlace[],
    minimums: Map<string, number>,
  ): void {
    const chosen = new Set(selected.map((candidate) => candidate.id));

    for (const category of ['cafe', 'restaurant', 'attraction']) {
      const missing = (minimums.get(category) ?? 0) - this.countCategory(selected, category);
      if (missing <= 0) continue;

      const fills = candidates
        .filter((candidate) => candidate.category === category && !chosen.has(candidate.id))
        .slice(0, missing);

      // 내줄 자리는 **과잉 종류의 꼬리**부터 — 하한을 지키고 있는 종류를 깎으면 안 된다.
      for (const fill of fills) {
        const dropIndex = this.lastSurplusIndex(selected, category, minimums);
        if (dropIndex < 0) break;
        chosen.delete(selected[dropIndex]!.id);
        selected.splice(dropIndex, 1, fill);
        chosen.add(fill.id);
      }
    }
  }

  private countCategory(selected: CandidatePlace[], category: string): number {
    return selected.filter((candidate) => candidate.category === category).length;
  }

  /**
   * 식음(음식점·카페)이 풀에서 차지하는 몫에 **상한**을 건다. 하한만 있고 상한이 없어서
   * 생기던 문제를 막는다 — 카카오 카탈로그는 어디를 찍어도 식음이 관광보다 많고(부산 실측
   * 음식점 2,915 + 카페 1,565 대 관광 1,463), 질의에 음식 취향 태그가 하나라도 있으면
   * ('바다·힐링·**해산물**' 부산) 식음이 상위를 쓸어 간다. 실측에서 상위 16 중 14가 횟집·카페였고
   * 해변 정답 13개는 전부 카탈로그에 있는데도 하나도 못 들어왔다.
   *
   * 두 가지를 지킨다 — 예전 상한 구현이 틀렸던 지점이다(위 주석 참고).
   *   1. **후보를 버리지 않는다.** 채울 관광 후보가 없으면 상한을 포기하고 그대로 둔다.
   *   2. **머리가 아니라 꼬리를 깎는다.** 넘치는 만큼 식음 꼬리를 관광 상위로 바꿀 뿐,
   *      점수 순서 자체는 건드리지 않는다.
   */
  private capDiningShare(
    selected: CandidatePlace[],
    candidates: CandidatePlace[],
    minimums: Map<string, number>,
  ): void {
    const ratio = this.maxDiningRatio();
    if (!(ratio < 1)) return;

    // **하한이 상한을 이긴다.** 상한 비율은 검색 지표(골든셋 정답에 식당이 거의 없다)에서 나온
    // 값이고, 하한은 일정이 실제로 필요로 하는 끼니 수다. 둘이 부딪히면 일정 쪽을 따른다 —
    // 3일 여행은 끼니만 6번이라 0.375 상한(풀 22 기준 8자리)이 카페 자리를 먼저 잡아먹는다.
    const diningFloor = (minimums.get('restaurant') ?? 0) + (minimums.get('cafe') ?? 0);
    const cap = Math.max(diningFloor, Math.floor(selected.length * ratio));
    const chosen = new Set(selected.map((candidate) => candidate.id));
    const fills = candidates.filter(
      (candidate) => ATTRACTION_CATEGORIES.has(candidate.category) && !chosen.has(candidate.id),
    );

    let fillIndex = 0;
    let dining = selected.filter((candidate) => DINING_CATEGORIES.has(candidate.category)).length;
    while (dining > cap && fillIndex < fills.length) {
      // 깎는 자리도 하한을 본다 — 그냥 마지막 식음을 빼면 방금 채운 카페 한 자리가 먼저 날아간다.
      const dropIndex = this.lastSurplusIndex(selected, 'attraction', minimums);
      if (dropIndex < 0) break;
      selected.splice(dropIndex, 1, fills[fillIndex]!);
      fillIndex += 1;
      dining -= 1;
    }
  }

  /** 풀에서 식음이 차지할 수 있는 최대 비율. 1 이면 상한 없음(종전 동작). */
  private maxDiningRatio(): number {
    const value = this.readWeight('CRAG_POOL_MAX_DINING_RATIO', DEFAULT_MAX_DINING_RATIO);
    return Math.max(0, Math.min(1, value));
  }

  /**
   * 교체해 내줄 수 있는 마지막 자리 (`findLastIndex` 는 이 tsconfig 의 lib 밖).
   * 채우려는 종류가 아니고, 빼도 **자기 종류의 하한**이 깨지지 않는 후보 중 가장 뒤에 있는 것.
   */
  private lastSurplusIndex(
    selected: CandidatePlace[],
    filling: string,
    minimums: Map<string, number>,
  ): number {
    for (let i = selected.length - 1; i >= 0; i -= 1) {
      const category = selected[i]!.category;
      if (category === filling) continue;
      if (this.countCategory(selected, category) <= (minimums.get(category) ?? 0)) continue;
      return i;
    }
    return -1;
  }

  private evaluate(
    candidate: RawPlaceCandidate,
    context: RetrievalContext,
    weights: TermWeights,
    expectedRegion: RegionFilter,
    judgement: PoolJudgement,
  ): CandidatePlace {
    const tags = candidate.tags?.length ? candidate.tags : inferPlaceTags(candidate);
    const matchedTags = this.matchedTags(tags, context);
    const penalties: string[] = [];
    const retrieval = this.retrievalScore(candidate);
    const personalization = this.personalizationScore(candidate);
    const taste = this.tasteScore(tags, context, personalization);
    const locality = this.localityScore(candidate, context, expectedRegion, judgement.region, penalties);
    const contextScore = this.contextScore(candidate, tags, context);
    const availability = this.availabilityScore(candidate, context, penalties);
    const popularity = this.popularityScore(candidate, context, judgement.popularity, penalties);
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
    const judgeable = !this.tasteFallbackNeutral() || tags.some((tag) => !FALLBACK_ONLY_TAGS.has(tag));
    const rawTagScore =
      preferred.length === 0 || !judgeable
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
    judgeable: boolean,
    penalties: string[],
  ): number {
    const index = context.popularityIndex;
    if (!index || index.docCount === 0 || !judgeable) return NEUTRAL_POPULARITY;
    const score = index.score(candidate.name);
    if (index.mentions(candidate.name) === 0) penalties.push('naver-unmentioned');
    return score;
  }

  /**
   * 이 후보 풀에서 인지도로 후보를 가를 수 있는지. **코퍼스가 그 지역 장소를 못 담았으면 포기한다.**
   *
   * 네이버 검색 API 의 `description` 은 본문이 아니라 **120자 스니펫**이라, "대구 실내 여행지
   * 6곳" 같은 글에서 정작 그 6곳의 이름이 코퍼스에 안 들어간다. 그 결과 지역마다 신호가 잡히는
   * 비율이 **1.3%~59.2% 로 46배** 벌어진다 (후보 400건 기준 실측):
   *
   *   속초 59.2% · 여수 30.8% · 전주 30.3% · 강릉 21.7% · 경주 20.9%
   *   광주 15.7% · 부산 13.3% · 제주 12.3% · 서울 6.0% · **대구 1.3%**
   *
   * 비율이 이렇게 낮으면 "언급 0" 은 **마이너 장소가 아니라 정보 없음**이다. 정보 없음에 감점을
   * 주면 신호가 아니라 노이즈고, 실측에서 대구 서문시장·팔공산·83타워가 전부 언급 0 으로 0.15 를
   * 받아 이름이 두 글자인 일반 상호(중립 0.50)에게 밀렸다 — 서문시장이 157건 중 31위였다.
   *
   * `localityJudgeable` 과 같은 철학이다: 가를 수 없으면 그 항을 끄고 나머지 항에 맡긴다.
   */
  private popularityJudgeable(candidates: RawPlaceCandidate[], context: RetrievalContext): boolean {
    const index = context.popularityIndex;
    if (!index || index.docCount === 0 || candidates.length === 0) return false;
    const mentioned = candidates.filter((candidate) => index.mentions(candidate.name) > 0).length;
    return mentioned / candidates.length >= this.minPopularityCoverage();
  }

  /**
   * 태그가 폴백뿐인 후보의 취향 점수를 중립으로 둘지 (`CRAG_TASTE_FALLBACK_NEUTRAL`).
   *
   * `inferPlaceTags` 는 항상 최소 하나를 준다 — attraction 이면 `cultural`, 그마저 없으면 `city`.
   * 그 둘뿐이라는 건 키워드 사전이 이 이름에서 **아무것도 못 읽었다**는 뜻이지 "취향에 안 맞는
   * 곳"이라는 뜻이 아니다. 구분이 없으면 사전의 빈틈이 그대로 감점이 된다 — 실측에서 속초
   * '신흥사'·'영금정', 부산 '오륙도' 가 인지도 **1.00**(코퍼스가 강하게 언급한 대표 명소)인데도
   * 태그 매칭 0 → taste 0.54 를 받아 17~19위로 밀렸다. taste 스프레드(0.28×가중 0.27=0.076)가
   * 인지도 차이(0.08×0.16=0.013)의 6배라 뒤집힌다.
   *
   * `localityJudgeable`·`popularityJudgeable` 과 같은 원칙이지만 **기본값은 끔**이다 —
   * 근거는 DEFAULT_TASTE_FALLBACK_NEUTRAL 주석.
   */
  private tasteFallbackNeutral(): boolean {
    const raw = this.config?.get<string>('CRAG_TASTE_FALLBACK_NEUTRAL');
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      return DEFAULT_TASTE_FALLBACK_NEUTRAL;
    }
    return String(raw).trim() !== 'false';
  }

  /** 인지도 항을 켤 최소 언급 비율. 근거는 DEFAULT_MIN_POPULARITY_COVERAGE 주석. */
  private minPopularityCoverage(): number {
    return this.readWeight('CRAG_MIN_POPULARITY_COVERAGE', DEFAULT_MIN_POPULARITY_COVERAGE);
  }

  /** 저장된 취향 벡터와의 코사인 유사도(-1~1)를 0~1 점수로 정규화 */
  private personalizationScore(candidate: RawPlaceCandidate): number | undefined {
    if (candidate.preferenceSimilarity === undefined) return undefined;
    return this.clamp((candidate.preferenceSimilarity + 1) / 2);
  }

  /**
   * 목적지와 후보를 **정본 지역 코드**로 비교한다 (적재·검색 pre-filter 와 같은 함수).
   *
   * 예전엔 `normalizeDestinationRegion` + 지역 키워드 사전이었는데, 그 두 곳이 아는 목적지가
   * **seoul·busan·jeju·gyeongju 넷뿐**이라 그 밖의 목적지에서는 첫 줄에서 `'default'` 로 빠져
   * **전 후보가 같은 값(0.62)** 이었다 — 즉 가드가 아예 돌지 않았다. 골든셋 14케이스 중 10케이스가
   * 그 상태였고, 영주 케이스(카카오 폴백)에서 후보 16개 전원이 0.62 인 것으로 드러났다.
   *
   * ⚠️ **시도는 시도끼리, 시군구는 시군구끼리** 비교한다. 교차 비교하면 `경기 광주시`(시군구 '광주')
   * 후보가 `광주광역시`(시도 '광주') 목적지와 맞는 것으로 읽힌다 — 통합 라벨 작업에서 한 번
   * 데인 지점이다.
   */
  private localityScore(
    candidate: RawPlaceCandidate,
    context: RetrievalContext,
    expected: RegionFilter,
    judgeable: boolean,
    penalties: string[],
  ): number {
    // 앵커 목적지('광안리'·'서면역')는 **행정 경계가 아니라 그 지점 주변**이 사용자가 말한
    // 범위다. 지역 코드로 보면 앵커 반경 안이 전부 같은 시도라 이 항이 전 후보 0.92 로 일률이
    // 되어 아무것도 못 가른다 — 반경으로 후보를 좁혀 놓고도 그 안에서 가까운 곳을 앞세울 수단이
    // 없었다. 반경을 못 채워 시도 전역을 덧댄 경우(에버랜드)엔 먼 후보가 같은 점수로 섞인다.
    if (context.anchor) {
      return this.anchorProximityScore(candidate, context.anchor);
    }

    if (!judgeable) return CragEvaluatorService.NEUTRAL_LOCALITY;

    const { regionCode, sigunguCode } = placeRegionCodes(
      candidate.destinationRegion ?? null,
      null,
      candidate.address ?? null,
    );
    // 지역 라벨이 없는 행(폴백 시드)은 판정 불가 — 데이터 없음을 '다른 지역'으로 읽으면 안 된다.
    if (!regionCode && !sigunguCode) return CragEvaluatorService.NEUTRAL_LOCALITY;

    if (matchesRegionFilter(expected, regionCode, sigunguCode)) return 0.92;
    penalties.push('destination-mismatch');
    return 0.32;
  }

  /**
   * 앵커에서의 거리 점수. **고정 밴드가 아니라 확정된 반경으로 정규화**한다.
   *
   * `distanceScore`(0.5/2/5/12km 밴드)를 그대로 쓰면 2km 앵커 안에서는 두 밴드(0.95·0.82)에만
   * 걸려 사실상 못 가른다 — 실측에서 서면역(2km 확정)이 지표 변화 0 이었다. 반경은 그 지역
   * 밀도에 맞춰 2→5→10km 로 정해지므로(§PlaceRetrievalService), 그 반경을 1.0 으로 놓고 재면
   * 밀집 지역과 한산한 지역이 같은 변별력을 갖는다.
   *
   * 반경 밖(시도 전역을 덧댄 경우)은 하한으로 눌러 가까운 후보 뒤에 세운다 — 그게 앵커를 쓴
   * 이유다. 하한을 0 으로 두지 않는 건 인지도 감점과 같은 이유로, 순위만 낮추고 탈락시키지
   * 않기 위해서다.
   */
  private anchorProximityScore(
    candidate: RawPlaceCandidate,
    anchor: { coordinates: Coordinates; radiusM: number },
  ): number {
    const edge = this.anchorEdgeScore();
    const radiusKm = Math.max(anchor.radiusM / 1000, 0.1);
    const ratio = this.distanceKm(candidate.coordinates, anchor.coordinates) / radiusKm;
    const score = CragEvaluatorService.ANCHOR_NEAR_SCORE - ratio * (CragEvaluatorService.ANCHOR_NEAR_SCORE - edge);
    return this.clamp(Math.max(score, Math.min(edge, CragEvaluatorService.ANCHOR_FAR_SCORE)));
  }

  /** 앵커 지점의 점수(거리 0). 지역 코드 일치(0.92)와 같은 수준에 둔다. */
  private static readonly ANCHOR_NEAR_SCORE = 0.95;
  /** 반경 밖(시도 전역 덧댐) 하한. 순위만 낮추고 탈락시키지는 않는다. */
  private static readonly ANCHOR_FAR_SCORE = 0.3;

  /**
   * 확정 반경 경계의 점수 = **거리 항의 세기**. 낮출수록 앵커 가까운 쪽이 강하게 우대된다.
   * 근거는 DEFAULT_ANCHOR_EDGE_SCORE 주석.
   */
  private anchorEdgeScore(): number {
    return this.readWeight('CRAG_ANCHOR_EDGE_SCORE', DEFAULT_ANCHOR_EDGE_SCORE);
  }

  /**
   * 목적지 코드로 후보를 가를 수 있는지. **한 후보도 안 맞으면 판정을 포기한다.**
   *
   * `destinationRegionFilter` 는 임의 문자열에서도 시군구 코드를 만들어 낸다('발리' → '발리').
   * 그런 코드로 비교하면 전 후보가 일률 감점되는데, 일률 감점은 **순위를 못 바꾸면서**
   * confidence 절대 수준만 0.06 내려 accept 게이트·폴백 임계를 흔든다(§dataQuality 제거에서
   * 같은 함정을 겪었다). 그래서 아무도 안 맞으면 가드를 끈다.
   */
  private localityJudgeable(candidates: RawPlaceCandidate[], expected: RegionFilter): boolean {
    if (!expected.sido && !expected.sigungu) return false;
    return candidates.some((candidate) => {
      const { regionCode, sigunguCode } = placeRegionCodes(
        candidate.destinationRegion ?? null,
        null,
        candidate.address ?? null,
      );
      return matchesRegionFilter(expected, regionCode, sigunguCode);
    });
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

  private distanceKm(from: Coordinates, to: Coordinates): number {
    const latDelta = (from.lat - to.lat) * 111;
    const lngDelta = (from.lng - to.lng) * 88;
    return Math.sqrt(latDelta ** 2 + lngDelta ** 2);
  }

  private clamp(value: number): number {
    return Math.max(0, Math.min(1, value));
  }
}
