import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { EmbeddingSource } from '../embedding/text-embedding.service';

export interface PreferenceEmbeddingProvenance {
  modelId: string;
  source: EmbeddingSource;
}

/**
 * 사용자 취향 임베딩 저장소 (preference_embeddings).
 * 유저당 1행을 upsert 하고, 검색 개인화 시 벡터를 다시 읽어온다.
 */
@Injectable()
export class PreferenceEmbeddingRepository {
  private readonly logger = new Logger(PreferenceEmbeddingRepository.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async upsertUserEmbedding(
    userId: string,
    vector: number[],
    tagsText: string,
    provenance: PreferenceEmbeddingProvenance,
  ): Promise<string> {
    if (vector.length === 0) return '';
    const embedding = `[${vector.join(',')}]`;
    try {
      const rows: Array<{ id: string }> = await this.dataSource.query(
        `
        INSERT INTO preference_embeddings (
          user_id, embedding, tags_text, embedding_model, embedding_source, updated_at
        )
        VALUES ($1, $2::vector, $3, $4, $5, NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET embedding = EXCLUDED.embedding,
                      tags_text = EXCLUDED.tags_text,
                      embedding_model = EXCLUDED.embedding_model,
                      embedding_source = EXCLUDED.embedding_source,
                      updated_at = NOW()
        RETURNING id
        `,
        [userId, embedding, tagsText, provenance.modelId, provenance.source],
      );
      return rows[0]?.id ?? '';
    } catch (error) {
      this.logger.warn(
        `취향 임베딩 저장 실패 (검색 개인화 생략): ${error instanceof Error ? error.message : String(error)}`,
      );
      return '';
    }
  }

  async findVectorByUser(userId: string, expectedModelId: string): Promise<number[] | null> {
    try {
      const rows: Array<{ embedding: string | null }> = await this.dataSource.query(
        `SELECT embedding::text AS embedding
         FROM preference_embeddings
         WHERE user_id = $1
           AND embedding_source = 'remote'
           AND embedding_model = $2
         LIMIT 1`,
        [userId, expectedModelId],
      );
      return this.parseVector(rows[0]?.embedding ?? null);
    } catch (error) {
      this.logger.warn(
        `취향 벡터 조회 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /** 그룹 일정 생성용 배치 조회. 멤버 수만큼 DB round-trip이 늘어나는 N+1을 막는다. */
  async findVectorsByUsers(userIds: string[], expectedModelId: string): Promise<Map<string, number[]>> {
    const uniqueIds = [...new Set(userIds.filter(Boolean))];
    if (uniqueIds.length === 0) return new Map();
    try {
      const rows: Array<{ user_id: string; embedding: string | null }> =
        await this.dataSource.query(
          `SELECT user_id, embedding::text AS embedding
           FROM preference_embeddings
           WHERE user_id = ANY($1::uuid[])
             AND embedding_source = 'remote'
             AND embedding_model = $2`,
          [uniqueIds, expectedModelId],
        );
      const vectors = new Map<string, number[]>();
      for (const row of rows) {
        const vector = this.parseVector(row.embedding);
        if (vector) vectors.set(row.user_id, vector);
      }
      return vectors;
    } catch (error) {
      this.logger.warn(
        `그룹 취향 벡터 조회 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      return new Map();
    }
  }

  private parseVector(raw: string | null): number[] | null {
    if (!raw) return null;
    const parsed = raw
      .replace(/^\[/, '')
      .replace(/\]$/, '')
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value));
    return parsed.length > 0 ? parsed : null;
  }
}
