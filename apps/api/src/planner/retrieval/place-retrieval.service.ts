import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getSeedCandidates, tasteTagsToKeywords } from './place-seeds';
import { CragEvaluatorService } from './crag-evaluator.service';
import { DestinationAnchorService } from './destination-anchor.service';
import { KakaoLocalService } from './kakao-local.service';
import { NaverSearchService, NEUTRAL_POPULARITY } from './naver-search.service';
import { PlaceEmbeddingRepository, toKstDateString } from './place-embedding.repository';
import { destinationRegionFilter } from './region-code';
import { TextEmbeddingService } from '../../embedding/text-embedding.service';
import { isEligibleItineraryCandidate } from './place-eligibility';
import type {
  CandidatePlace,
  DestinationAnchor,
  RawPlaceCandidate,
  RetrievalContext,
  RetrievalResult,
  RetrievalSource,
  VisitWindow,
} from './types';

/** 일정에 식사 슬롯을 채우는 카테고리. 앵커 반경이 충분한지 판정할 때 쓴다. */
const DINING_CATEGORIES: ReadonlySet<string> = new Set(['restaurant', 'cafe']);

/**
 * 앵커 반경 확장 단계(m). 부족하면 다음 단계로 넓히고, 마지막까지 부족하면 지역 전역을 덧댄다.
 *
 * 실측 카탈로그(10,333행)에서 반경별 후보 수(괄호는 식당·카페)를 재서 정했다:
 *
 * | 앵커 | 2km | 5km | 10km |
 * |---|---|---|---|
 * | 광안리 | 17 (2) | 144 (61) | 368 (122) |
 * | 서면역 | 36 (4) | 151 (62) | 386 (128) |
 * | 감천문화마을 | 65 (25) | 107 (30) | 286 (98) |
 * | 남이섬 | 7 (1) | 55 (24) | 96 (46) |
 * | 에버랜드 | 2 (0) | 4 (1) | 15 (2) |
 *
 * 고정 반경이 안 되는 이유가 이 표에 다 있다 — 2km 로 고정하면 광안리에 식사 후보가 2곳뿐이고,
 * 10km 로 고정하면 감천문화마을 여행이 부산 절반으로 번진다. 에버랜드처럼 카탈로그가 얇은
 * 앵커는 어떤 반경으로도 못 채우므로 지역 폴백이 있어야 한다.
 */
const DEFAULT_RADIUS_STEPS_M = [2000, 5000, 10000] as const;

/** 앵커 반경이 "충분하다"고 볼 최소 종류별 후보 수. 일정에 식사와 볼거리가 둘 다 필요하다. */
const MIN_KIND_COUNT = 4;

@Injectable()
export class PlaceRetrievalService {
  private readonly logger = new Logger(PlaceRetrievalService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly embeddings: TextEmbeddingService,
    private readonly placeEmbeddings: PlaceEmbeddingRepository,
    private readonly kakaoLocal: KakaoLocalService,
    private readonly evaluator: CragEvaluatorService,
    private readonly naverSearch: NaverSearchService,
    private readonly anchors: DestinationAnchorService,
  ) {}

  async retrieve(inputContext: RetrievalContext): Promise<RetrievalResult> {
    // 앞단: 목적지 네이버 추천 글로 대중 인지도 인덱스를 만들어 랭킹 컨텍스트에 주입한다.
    // 이후 모든 evaluator.rank 호출이 이 인덱스로 마이너 장소를 후순위로 민다.
    const popularityIndex = await this.naverSearch.getPopularityIndex(inputContext.destination);
    // 행정구역으로 안 잡히는 목적지('광안리')만 좌표 앵커로 해석된다. 나머지는 null 이라
    // 아래 경로가 통째로 기존과 같다.
    const anchor = await this.anchors.resolve(inputContext.destination);
    // 지역 코드는 한 번만 해석해 내려보낸다 — 소비측이 destination 문자열에서 각자
    // 재계산하면 앵커로 알아낸 지역('광안리'→부산)을 못 보고 죽은 코드로 되돌아간다.
    const regionFilter = anchor?.region ?? destinationRegionFilter(inputContext.destination);
    const context: RetrievalContext = { ...inputContext, popularityIndex, regionFilter };
    const limit = context.limit ?? 16;
    const queryText = this.buildQueryText(context);
    const sources: RetrievalSource[] = [];
    const rawCandidates: RawPlaceCandidate[] = [];
    const queryEmbedding = await this.embeddings.embed(queryText);
    // 차원이 맞는 취향 벡터만 사용 (차원 불일치 시 pgvector 코사인이 통째로 실패하는 것 방지)
    const preferenceVector =
      context.preferenceVector && context.preferenceVector.length === queryEmbedding.length
        ? context.preferenceVector
        : undefined;
    if (context.preferenceVector && !preferenceVector) {
      this.logger.warn(
        `취향 벡터 차원(${context.preferenceVector.length})이 질의 벡터(${queryEmbedding.length})와 달라 개인화를 건너뜁니다. reembed:preferences 로 재임베딩이 필요합니다.`,
      );
    }
    // 목적지/이벤트 질의 벡터에 저장된 취향 벡터를 가중 결합해 검색 자체를 개인화
    const searchEmbedding = this.blendPreference(queryEmbedding, preferenceVector);

    // 앵커가 있으면 그 지역 카탈로그는 이미 적재돼 있다(앵커 해석 자체가 지역을 알아낸 것).
    // '광안리' 로 시드를 찾아 봐야 전용 카탈로그가 없어 매번 빈손으로 로그만 남는다.
    if (!anchor) await this.seedLocalCatalogIfNeeded(context.destination);

    const poolSize = limit * this.candidatePoolMultiplier();
    // 기간 있는 행사(축제)는 이 구간과 겹칠 때만 후보로 남는다. 여행 날짜를 모르면 오늘 기준.
    const visitWindow = this.visitWindow(context);
    let pgvector: RawPlaceCandidate[];
    if (anchor) {
      const around = await this.searchAroundAnchor(
        anchor,
        searchEmbedding,
        poolSize,
        limit,
        visitWindow,
        preferenceVector,
      );
      // 확정된 반경을 컨텍스트에 실어 카카오 폴백이 같은 범위를 보게 한다.
      context.anchor = { ...anchor, radiusM: around.radiusM };
      pgvector = around.candidates;
    } else {
      pgvector = this.filterEligibleCandidates(
        await this.placeEmbeddings.searchByEmbedding(
          searchEmbedding,
          { kind: 'region', region: regionFilter },
          poolSize,
          preferenceVector,
          visitWindow,
        ),
        'pgvector',
      );
    }
    if (pgvector.length > 0) {
      sources.push('pgvector');
      rawCandidates.push(...pgvector);
    }

    let ranked = this.evaluator.rank(rawCandidates, context);
    if (!this.isStrongEnough(ranked, limit)) {
      const kakao = this.filterEligibleCandidates(
        await this.kakaoLocal.search(context, limit * 2),
        'kakao',
      );
      if (kakao.length > 0) {
        sources.push('kakao');
        rawCandidates.push(...kakao);
        ranked = this.evaluator.rank(rawCandidates, context);
      }
    }

    // 시드 폴백은 목적지 전용 카탈로그가 없으면 DEFAULT_SEEDS(서울 도심 좌표의 가짜 장소 6개)를
    // 준다. 앵커를 아는 여행에 그걸 섞으면 부산 일정에 서울 좌표가 박혀 동선이 깨지므로,
    // 실제 후보가 한 건도 없을 때만(=아무것도 안 주는 것보다는 나을 때) 허용한다.
    const seedAllowed = !anchor || rawCandidates.length === 0;
    if (!this.isStrongEnough(ranked, limit) && seedAllowed) {
      const seeds = this.filterEligibleCandidates(
        getSeedCandidates(context.destination),
        'seed',
      );
      sources.push('seed');
      rawCandidates.push(...seeds);
      ranked = this.evaluator.rank(rawCandidates, context);
    }

    const minimumConfidence = this.minimumConfidence();
    // 인지도는 "소프트 재랭킹"이라 순위만 낮출 뿐 후보를 탈락시키면 안 된다.
    // 중립값 아래로 깎인 감점분은 accept 게이트에서만 되돌려, 언급 0 이라는 이유로
    // minimumConfidence 를 밑돌아 제거되는 일을 막는다(정렬 순서엔 감점 그대로 반영).
    // 되돌리는 폭은 상수가 아니라 **실효 가중치**여야 한다 — CRAG_RETRIEVAL_WEIGHT 를 바꾸면
    // 인지도 가중도 비례 배분으로 함께 움직이므로, 상수를 쓰면 과·소보정이 된다.
    const popularityWeight = this.evaluator.weights().popularity;
    const gateConfidence = (candidate: CandidatePlace): number =>
      candidate.confidence +
      popularityWeight * Math.max(0, NEUTRAL_POPULARITY - candidate.crag.popularity);
    const accepted = ranked.filter((candidate) => gateConfidence(candidate) >= minimumConfidence);
    const finalPool = accepted.length >= Math.min(4, limit) ? accepted : ranked;
    const places = this.evaluator.selectTopDiverse(finalPool, limit);
    const averageConfidence = this.averageConfidence(places);
    const rejectedCount = Math.max(0, ranked.length - accepted.length);

    const popularCount = places.filter((place) => popularityIndex.mentions(place.name) > 0).length;
    const scope = context.anchor
      ? `anchor="${context.anchor.label}"/${context.anchor.radiusM / 1000}km`
      : `region=${regionFilter.sido ?? regionFilter.sigungu ?? 'none'}`;
    this.logger.log(
      `CRAG retrieval for "${context.destination}" ${scope} sources=${sources.join('+') || 'none'} avg=${averageConfidence.toFixed(2)} selected=${places.length} naver=${popularityIndex.docCount}docs/${popularCount}matched`,
    );

    return {
      places,
      trace: {
        queryText,
        sources: [...new Set(sources)],
        fallbackUsed: sources.some((source) => source !== 'pgvector'),
        averageConfidence,
        rejectedCount,
      },
    };
  }

  /**
   * 앵커 주변을 반경을 넓혀 가며 훑는다.
   *
   * 마지막 단계까지 부족하면 앵커가 알아낸 지역 전역 검색을 **덧댄다(교체가 아니다)** —
   * 가까운 후보를 지역 상위 N 경쟁에 밀려 잃으면 앵커를 쓴 의미가 없다. id 중복은
   * `evaluator.rank` 의 dedupe 가 접는다.
   */
  private async searchAroundAnchor(
    anchor: DestinationAnchor,
    embedding: number[],
    poolSize: number,
    limit: number,
    visitWindow: VisitWindow,
    preferenceVector?: number[],
  ): Promise<{ candidates: RawPlaceCandidate[]; radiusM: number }> {
    const steps = this.radiusStepsM();
    const search = async (radiusM: number): Promise<RawPlaceCandidate[]> =>
      this.filterEligibleCandidates(
        await this.placeEmbeddings.searchByEmbedding(
          embedding,
          { kind: 'anchor', center: anchor.coordinates, radiusM },
          poolSize,
          preferenceVector,
          visitWindow,
        ),
        'pgvector',
      );

    let candidates: RawPlaceCandidate[] = [];
    for (const step of steps) {
      candidates = await search(step);
      if (this.isAnchorPoolSufficient(candidates, limit)) {
        this.logger.log(
          `앵커 "${anchor.label}" 반경 ${step / 1000}km 후보 ${candidates.length}건으로 확정`,
        );
        return { candidates, radiusM: step };
      }
    }

    const widest = steps[steps.length - 1]!;
    const regional = this.filterEligibleCandidates(
      await this.placeEmbeddings.searchByEmbedding(
        embedding,
        { kind: 'region', region: anchor.region },
        poolSize,
        preferenceVector,
        visitWindow,
      ),
      'pgvector',
    );
    const seen = new Set(candidates.map((candidate) => candidate.id));
    const merged = [
      ...candidates,
      ...regional.filter((candidate) => !seen.has(candidate.id)),
    ];
    this.logger.log(
      `앵커 "${anchor.label}" 최대 반경 ${widest / 1000}km 로도 후보가 얇아(${candidates.length}건) ` +
        `${anchor.region.sido ?? anchor.region.sigungu} 전역 ${regional.length}건을 덧댔습니다.`,
    );
    return { candidates: merged, radiusM: widest };
  }

  /**
   * 앵커 반경 후보 풀이 이 반경에서 멈춰도 될 만큼 찼는지.
   *
   * **개수만 보면 안 된다** — 실측에서 광안리 2km 는 17건이나 되는데 식당·카페가 2곳뿐이라
   * 하루치 식사 슬롯도 못 채운다. 그래서 종류별 하한을 함께 본다. 전체 개수는 최종 선택
   * 수(limit)의 2배를 요구한다 — 그 정도는 돼야 인지도·취향 재정렬이 손댈 여지가 생긴다.
   */
  private isAnchorPoolSufficient(candidates: RawPlaceCandidate[], limit: number): boolean {
    if (candidates.length < limit * 2) return false;
    const dining = candidates.filter((candidate) =>
      DINING_CATEGORIES.has(candidate.category),
    ).length;
    return dining >= MIN_KIND_COUNT && candidates.length - dining >= MIN_KIND_COUNT;
  }

  /**
   * 후보를 방문할 날짜 구간. 여행 날짜를 모르는 호출(스크립트·진단)은 오늘 하루로 본다 —
   * 이미 끝난 행사를 후보로 내주지 않는 쪽이 안전한 기본값이다.
   */
  private visitWindow(context: RetrievalContext): VisitWindow {
    if (context.visitWindow) {
      const { from, to } = context.visitWindow;
      // 뒤집힌 구간이 들어오면 조건이 아무것도 통과시키지 못하므로 순서를 바로잡는다.
      return from <= to ? { from, to } : { from: to, to: from };
    }
    const day = toKstDateString(context.startAt ?? new Date());
    return { from: day, to: day };
  }

  /** 앵커 반경 확장 단계(m). 오름차순으로 정렬해 넓혀 가는 순서를 보장한다. */
  private radiusStepsM(): number[] {
    const parsed = this.config
      .get<string>('PLACE_ANCHOR_RADIUS_STEPS_M', '')
      .split(',')
      .map((token) => Number(token.trim()))
      .filter((value) => Number.isFinite(value) && value > 0);
    return parsed.length > 0 ? parsed.sort((a, b) => a - b) : [...DEFAULT_RADIUS_STEPS_M];
  }

  private async seedLocalCatalogIfNeeded(destination: string): Promise<void> {
    if (!this.autoSeedEnabled()) return;
    // 게이트는 검색과 같은 정본 코드로 센다 — seed 슬러그 라벨만 세던 시절엔 적재된 카탈로그
    // (라벨 '서울특별시')를 못 보고 매 지역에 시드를 덧칠했다.
    const count = await this.placeEmbeddings.countRegionCandidates(destination);
    if (count > 0) return;

    try {
      await this.placeEmbeddings.seedRegion(destination, (text) => this.embeddings.embed(text));
    } catch (error) {
      this.logger.warn(
        `Local place embedding seed skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 질의 벡터와 취향 벡터를 가중 결합한 뒤 L2 정규화.
   * weight=1 이면 순수 질의 벡터, 0 이면 순수 취향 벡터.
   */
  private blendPreference(query: number[], preference?: number[]): number[] {
    if (!preference || preference.length !== query.length) return query;
    const weight = this.preferenceBlendWeight();
    const blended = query.map((value, index) => value * weight + (preference[index] ?? 0) * (1 - weight));
    const norm = Math.sqrt(blended.reduce((sum, value) => sum + value * value, 0));
    if (norm === 0) return query;
    return blended.map((value) => value / norm);
  }

  /**
   * 질의 벡터와 취향 벡터의 결합 비율 (1 이면 순수 질의).
   *
   * 0.6 → 0.85. 골든셋 스윕에서 블렌드를 낮출수록 목적지 대표 장소를 잘 찾는다
   * (R|cat 0.6→0.337, 0.85→0.371, 1.0→0.370). **개인화를 버리는 결정이 아니다** —
   * 취향은 질의 텍스트의 `taste:` 태그와 CRAG taste 항으로도 들어가고, 벡터 블렌드는 세 번째
   * 채널이다. 그 세 번째가 목적지 정합을 깎고 있었다. 1.0(완전 차단) 대신 0.85 인 이유는
   * 지표가 1.0 과 동등한 범위이고, 사진 취향이 강한 사용자에게 줄 미세 조정을 남겨 두는 쪽이
   * 안전해서다.
   *
   * ⚠️ 골든셋 정답은 '그 목적지의 유명 명소' 라 개인화 품질 자체는 측정하지 못한다.
   * 이 값을 더 내리는(=블렌드를 더 끄는) 근거로 이 지표만 쓰면 안 된다.
   */
  /**
   * 최종 개수(limit)의 몇 배까지 pgvector 후보를 뽑을지.
   *
   * 이 배수가 곧 **인지도·취향 재정렬이 손댈 수 있는 범위의 한계**다 — 선발은 순전히 벡터
   * 거리(`ORDER BY embedding <=> query`)이고 인지도는 그 뒤의 재정렬에만 관여하므로,
   * 풀에 못 들어온 장소는 인지도가 아무리 높아도 결과에 나올 길이 없다.
   *
   * 3 → 10. 서울처럼 한 지역에 후보가 몰린 곳에서 청계천·북촌한옥마을이 적재돼 있는데도
   * 상위 48 밖이라 결과에 못 들어왔다(서울 R|cat 0.00 → 0.50). **비용은 거의 없다** —
   * 지역 pre-filter 가 이미 그 지역 전체 행의 거리를 계산하므로 LIMIT 은 top-N 힙 크기만
   * 바꾼다(서울 660행에서 48→320 이 31kB→60kB, 실행시간 5~6ms 로 동일). 늘어나는 건
   * 재정렬 대상 수(Node CPU)뿐이고, 후보가 적은 지역은 LIMIT 이 상한일 뿐이라 영향이 없다.
   *
   * 20 은 R|cat 이 0.498→0.507 로 미세하게 오르는 대신 MRR 이 0.735→0.689 로 떨어진다
   * (상위에 노이즈가 함께 들어온다). 10 이 무릎이다.
   */
  private candidatePoolMultiplier(): number {
    const value = this.readNumber('PLACE_CANDIDATE_POOL_MULTIPLIER', 10);
    return Math.max(1, Math.floor(value));
  }

  private preferenceBlendWeight(): number {
    const weight = this.readNumber('PREFERENCE_BLEND_WEIGHT', 0.85);
    return Math.max(0, Math.min(1, weight));
  }

  private buildQueryText(context: RetrievalContext): string {
    const tags = tasteTagsToKeywords(context.tasteTags);
    const trigger = context.trigger ? `event:${context.trigger}` : 'event:initial';
    const notes = context.notes?.trim() ? `notes:${context.notes.trim()}` : '';
    return [
      `destination:${context.destination}`,
      trigger,
      tags.length > 0 ? `taste:${tags.join(', ')}` : '',
      notes,
    ].filter(Boolean).join(' | ');
  }

  private isStrongEnough(candidates: CandidatePlace[], limit: number): boolean {
    const targetCount = Math.min(limit, 8);
    if (candidates.length < Math.min(4, targetCount)) return false;
    const top = candidates.slice(0, targetCount);
    return this.averageConfidence(top) >= this.targetConfidence();
  }

  private filterEligibleCandidates(
    candidates: RawPlaceCandidate[],
    source: RetrievalSource,
  ): RawPlaceCandidate[] {
    const eligible = candidates.filter(isEligibleItineraryCandidate);
    const excludedCount = candidates.length - eligible.length;
    if (excludedCount > 0) {
      this.logger.debug(`자동 일정 부적합 장소 ${excludedCount}건 제외 (source=${source})`);
    }
    return eligible;
  }

  private averageConfidence(candidates: CandidatePlace[]): number {
    if (candidates.length === 0) return 0;
    return candidates.reduce((sum, candidate) => sum + candidate.confidence, 0) / candidates.length;
  }

  private minimumConfidence(): number {
    return this.readNumber('CRAG_MIN_CONFIDENCE', 0.52);
  }

  /**
   * 이 값을 밑돌면 카카오·시드 폴백을 부른다.
   *
   * 0.64 → 0.61. **품질 기준을 낮춘 게 아니라 가중표 변경분을 되맞춘 것이다** — `dataQuality`
   * 항(전 후보 1.000 인 상수)을 제거하자 남은 몫이 값이 1 보다 작은 항들로 비례 배분돼 모든 후보의
   * confidence 가 일률적으로 **0.02 내려갔다**(케이스별 0.018~0.029). 임계는 절대값이라 그대로
   * 두면 순위가 아무것도 안 바뀌었는데 폴백만 새로 걸린다 — 실측에서 daegu 케이스가
   * top-8 평균 0.648 → 0.619 로 넘어가 카카오·시드를 불렀고, **결과 상위 5개와 지표는 완전히
   * 동일**했다(외부 API 호출만 추가).
   *
   * ⚠️ 절대 임계는 가중표에 묶여 있다 — 항을 더하거나 빼면 여기도 같이 재보정해야 한다.
   * accept 게이트(`CRAG_MIN_CONFIDENCE` 0.52)는 선택 후보 최저값이 0.589 로 여유가 커 그대로 뒀다.
   */
  private targetConfidence(): number {
    return this.readNumber('CRAG_TARGET_CONFIDENCE', 0.61);
  }

  private autoSeedEnabled(): boolean {
    const raw = this.config.get<string>('PLACE_RETRIEVAL_AUTO_SEED', 'true');
    return raw !== 'false';
  }

  private readNumber(key: string, fallback: number): number {
    const value = Number(this.config.get<string | number>(key, fallback));
    return Number.isFinite(value) ? value : fallback;
  }
}
