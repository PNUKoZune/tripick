import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PreferencesService } from '../../preferences/preferences.service';
import type { PlaceDto } from '@tripick/types';

/**
 * pgvector 취향 임베딩 RAG 조회 Helper
 *
 * CRAG 보정 구조:
 * 1. pgvector 유사도 검색
 * 2. confidence 낮으면 외부 API fallback
 * 3. 검증된 후보만 반환
 */
@Injectable()
export class PreferenceHelper {
  constructor(
    private readonly preferencesService: PreferencesService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /**
   * 사용자 취향 임베딩과 유사한 장소 후보 조회
   * confidence >= 0.9 인 결과만 반환
   */
  async getCandidates(userId: string, destination: string): Promise<PlaceDto[]> {
    const pref = await this.preferencesService.findByUser(userId);
    if (!pref?.embeddingId) return [];

    // pgvector cosine similarity 검색
    // <=> 연산자: cosine distance (낮을수록 유사)
    const rows: Array<{ id: string; name: string; similarity: number }> =
      await this.dataSource.query(
        `
        SELECT p.id, p.name, p.address, p.coordinates, p.category,
               1 - (p.embedding <=> (
                 SELECT embedding FROM preference_embeddings WHERE id = $1
               )) AS similarity
        FROM place_embeddings p
        WHERE p.destination_region = $2
          AND 1 - (p.embedding <=> (
            SELECT embedding FROM preference_embeddings WHERE id = $1
          )) >= 0.9
        ORDER BY similarity DESC
        LIMIT 20
        `,
        [pref.embeddingId, destination],
      );

    // TODO: confidence 낮은 결과 → 한국관광공사 API fallback + reranking
    return rows as unknown as PlaceDto[];
  }
}
