import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getSeedCandidates, tasteTagsToKeywords } from './place-seeds';
import { CragEvaluatorService } from './crag-evaluator.service';
import { KakaoLocalService } from './kakao-local.service';
import { PlaceEmbeddingRepository } from './place-embedding.repository';
import { TextEmbeddingService } from './text-embedding.service';
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
    const embedding = await this.embeddings.embed(queryText);

    await this.seedLocalCatalogIfNeeded(context.destination);

    const pgvector = await this.placeEmbeddings.searchByEmbedding(
      embedding,
      context.destination,
      limit * 3,
    );
    if (pgvector.length > 0) {
      sources.push('pgvector');
      rawCandidates.push(...pgvector);
    }

    let ranked = this.evaluator.rank(rawCandidates, context);
    if (!this.isStrongEnough(ranked, limit)) {
      const kakao = await this.kakaoLocal.search(context, limit * 2);
      if (kakao.length > 0) {
        sources.push('kakao');
        rawCandidates.push(...kakao);
        ranked = this.evaluator.rank(rawCandidates, context);
      }
    }

    if (!this.isStrongEnough(ranked, limit)) {
      const seeds = getSeedCandidates(context.destination);
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
