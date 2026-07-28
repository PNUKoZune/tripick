import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getSeedCandidates, tasteTagsToKeywords } from './place-seeds';
import { CragEvaluatorService, POPULARITY_WEIGHT } from './crag-evaluator.service';
import { KakaoLocalService } from './kakao-local.service';
import { NaverSearchService, NEUTRAL_POPULARITY } from './naver-search.service';
import { PlaceEmbeddingRepository } from './place-embedding.repository';
import { TextEmbeddingService } from '../../embedding/text-embedding.service';
import { isEligibleItineraryCandidate } from './place-eligibility';
import type {
  CandidatePlace,
  RawPlaceCandidate,
  RetrievalContext,
  RetrievalResult,
  RetrievalSource,
} from './types';

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
  ) {}

  async retrieve(inputContext: RetrievalContext): Promise<RetrievalResult> {
    // 앞단: 목적지 네이버 추천 글로 대중 인지도 인덱스를 만들어 랭킹 컨텍스트에 주입한다.
    // 이후 모든 evaluator.rank 호출이 이 인덱스로 마이너 장소를 후순위로 민다.
    const popularityIndex = await this.naverSearch.getPopularityIndex(inputContext.destination);
    const context: RetrievalContext = { ...inputContext, popularityIndex };
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

    await this.seedLocalCatalogIfNeeded(context.destination);

    const pgvector = this.filterEligibleCandidates(
      await this.placeEmbeddings.searchByEmbedding(
        searchEmbedding,
        context.destination,
        limit * 3,
        preferenceVector,
      ),
      'pgvector',
    );
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

    if (!this.isStrongEnough(ranked, limit)) {
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
    const gateConfidence = (candidate: CandidatePlace): number =>
      candidate.confidence +
      POPULARITY_WEIGHT * Math.max(0, NEUTRAL_POPULARITY - candidate.crag.popularity);
    const accepted = ranked.filter((candidate) => gateConfidence(candidate) >= minimumConfidence);
    const finalPool = accepted.length >= Math.min(4, limit) ? accepted : ranked;
    const places = this.evaluator.selectTopDiverse(finalPool, limit);
    const averageConfidence = this.averageConfidence(places);
    const rejectedCount = Math.max(0, ranked.length - accepted.length);

    const popularCount = places.filter((place) => popularityIndex.mentions(place.name) > 0).length;
    this.logger.log(
      `CRAG retrieval for "${context.destination}" sources=${sources.join('+') || 'none'} avg=${averageConfidence.toFixed(2)} selected=${places.length} naver=${popularityIndex.docCount}docs/${popularCount}matched`,
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

  private async seedLocalCatalogIfNeeded(destination: string): Promise<void> {
    if (!this.autoSeedEnabled()) return;
    const count = await this.placeEmbeddings.countSeededRegion(destination);
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

  private targetConfidence(): number {
    return this.readNumber('CRAG_TARGET_CONFIDENCE', 0.64);
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
