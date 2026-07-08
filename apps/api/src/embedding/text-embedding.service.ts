import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

/** 임베딩 벡터 출처. 'hash' 는 원격 서버 실패 시 결정적 폴백을 의미. */
export type EmbeddingSource = 'remote' | 'hash';

export interface EmbeddingResult {
  vector: number[];
  source: EmbeddingSource;
}

@Injectable()
export class TextEmbeddingService {
  private readonly logger = new Logger(TextEmbeddingService.name);

  constructor(private readonly config: ConfigService) {}

  async embed(text: string): Promise<number[]> {
    return (await this.embedWithSource(text)).vector;
  }

  /**
   * 임베딩 벡터와 함께 출처(remote/hash)를 반환한다.
   * 적재/재임베딩 파이프라인이 해시 폴백을 감지해 중단할 수 있게 하기 위함.
   */
  async embedWithSource(text: string): Promise<EmbeddingResult> {
    const vector = await this.tryRemoteEmbedding(text);
    if (vector.length > 0) {
      return { vector: this.normalizeDimensions(vector), source: 'remote' };
    }
    return { vector: this.buildHashEmbedding(text), source: 'hash' };
  }

  private async tryRemoteEmbedding(text: string): Promise<number[]> {
    // 임베딩 전용 서버를 별도 포트로 띄우는 경우 LLM_EMBEDDING_BASE_URL 로 분리.
    // 미설정 시 chat 과 동일한 LLM_BASE_URL 로 폴백(하위호환).
    const baseUrl =
      this.config.get<string>('LLM_EMBEDDING_BASE_URL') ??
      this.config.get<string>('LLM_BASE_URL', 'http://localhost:8080/v1');
    const apiKey =
      this.config.get<string>('LLM_EMBEDDING_API_KEY') ??
      this.config.get<string>('LLM_API_KEY', 'local');
    const model = this.config.get<string>('LLM_EMBEDDING_MODEL', 'text-embedding-model');

    try {
      const res = await axios.post<{ data: Array<{ embedding: number[] }> }>(
        `${baseUrl}/embeddings`,
        { input: text, model },
        { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 7000 },
      );
      return res.data.data[0]?.embedding ?? [];
    } catch (error) {
      this.logger.warn(
        `Embedding endpoint unavailable, using deterministic local embedding: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  private buildHashEmbedding(text: string): number[] {
    const dimensions = this.dimensions();
    const vector = new Array<number>(dimensions).fill(0);
    const tokens = text
      .toLowerCase()
      .split(/[^a-z0-9가-힣]+/u)
      .map((token) => token.trim())
      .filter(Boolean);
    const sourceTokens = tokens.length > 0 ? tokens : [text || 'tripick'];

    sourceTokens.forEach((token, tokenIndex) => {
      let hash = 2166136261;
      for (let index = 0; index < token.length; index += 1) {
        hash ^= token.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      hash >>>= 0;
      const slot = hash % dimensions;
      const sign = (hash & 1) === 0 ? 1 : -1;
      const weight = 1 + Math.min(token.length, 16) / 16 + tokenIndex / (sourceTokens.length * 8);
      vector[slot] = (vector[slot] ?? 0) + sign * weight;
      const secondarySlot = (slot * 31 + 17) % dimensions;
      vector[secondarySlot] = (vector[secondarySlot] ?? 0) + sign * weight * 0.35;
    });

    return this.l2Normalize(vector);
  }

  private normalizeDimensions(vector: number[]): number[] {
    const dimensions = this.dimensions();
    const normalized = vector.slice(0, dimensions);
    while (normalized.length < dimensions) {
      normalized.push(0);
    }
    return this.l2Normalize(normalized);
  }

  private l2Normalize(vector: number[]): number[] {
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    if (norm === 0) {
      const fallback = new Array<number>(this.dimensions()).fill(0);
      fallback[0] = 1;
      return fallback;
    }
    return vector.map((value) => Number((value / norm).toFixed(8)));
  }

  private dimensions(): number {
    // 기본값은 place_embeddings/preference_embeddings 컬럼 차원(BGE-m3-ko=1024)과 일치시킨다.
    const raw = this.config.get<string | number>('LLM_EMBEDDING_DIMENSIONS', 1024);
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1024;
  }
}
