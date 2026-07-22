import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getSeedCandidates, tasteTagsToKeywords } from './place-seeds';
import { CragEvaluatorService } from './crag-evaluator.service';
import { KakaoLocalService } from './kakao-local.service';
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
  ) {}

  async retrieve(context: RetrievalContext): Promise<RetrievalResult> {
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
    const accepted = ranked.filter((candidate) => candidate.confidence >= minimumConfidence);
    const finalPool = accepted.length >= Math.min(4, limit) ? accepted : ranked;
    const places = this.evaluator.selectTopDiverse(finalPool, limit);
    const averageConfidence = this.averageConfidence(places);
    const rejectedCount = Math.max(0, ranked.length - accepted.length);

    this.logger.log(
      `CRAG retrieval for "${context.destination}" sources=${sources.join('+') || 'none'} avg=${averageConfidence.toFixed(2)} selected=${places.length}`,
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

  private preferenceBlendWeight(): number {
    const weight = this.readNumber('PREFERENCE_BLEND_WEIGHT', 0.6);
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
