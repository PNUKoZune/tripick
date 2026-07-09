import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Coordinates } from '@tripick/types';
import {
  buildPlaceEmbeddingText,
  getSeedPlaces,
  inferPlaceTags,
  normalizeDestinationRegion,
  regionStem,
} from './place-seeds';
import type { RawPlaceCandidate } from './types';

export interface UpsertPlaceInput {
  kakaoPlaceId?: string | null;
  tourismApiId?: string | null;
  name: string;
  address?: string | null;
  category?: string | null;
  /** destination_region 컬럼에 저장할 지역 라벨 (예: '서울', 'seoul') */
  region: string;
  /** region_sigungu 컬럼에 저장할 시군구 라벨 (예: '경주시') */
  regionSigungu?: string | null;
  coordinates: Coordinates;
  imageUrl?: string | null;
  /** 임베딩 대상 텍스트 해시 (증분 upsert 판정용) */
  textHash?: string | null;
  /** 임베딩에 사용한 모델 식별자 */
  embeddingModel?: string | null;
}

/** 멱등/증분 판정을 위한 기존 행 조회 결과. */
export interface PlaceProvenance {
  id: string;
  textHash: string | null;
  embeddingModel: string | null;
}

/** upsertPlace 시 중복/기존 행을 찾기 위한 키. */
export interface PlaceDedupeKey {
  kakaoPlaceId?: string | null;
  tourismApiId?: string | null;
  region: string;
  name: string;
}

interface PlaceEmbeddingRow {
  id: string;
  kakao_place_id?: string | null;
  tourism_api_id?: string | null;
  name: string;
  address?: string | null;
  category?: string | null;
  destination_region?: string | null;
  coordinates?: Coordinates | string | null;
  similarity?: number | string | null;
  preference_similarity?: number | string | null;
}

@Injectable()
export class PlaceEmbeddingRepository {
  private readonly logger = new Logger(PlaceEmbeddingRepository.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async searchByEmbedding(
    embedding: number[],
    destination: string,
    limit: number,
    preferenceVector?: number[],
  ): Promise<RawPlaceCandidate[]> {
    // 목적지 어간(접미사 제거)으로 시도/시군구를 매칭한다.
    // 예: '경주' → region_sigungu '경주시' 프리픽스 매칭, '부산' → destination_region '부산' 매칭.
    const stem = regionStem(destination);
    const stemLike = stem ? `${stem}%` : '';
    const destinationLike = `%${destination}%`;
    const vector = `[${embedding.join(',')}]`;
    const hasPreference = Array.isArray(preferenceVector) && preferenceVector.length > 0;
    // 취향 벡터가 있으면 후보별 취향 코사인을 SQL 에서 함께 계산해 리랭킹 신호로 사용
    const preference = hasPreference ? `[${preferenceVector.join(',')}]` : null;
    const preferenceSelect = hasPreference
      ? '1 - (embedding <=> $5::vector) AS preference_similarity'
      : 'NULL AS preference_similarity';
    const params = hasPreference
      ? [vector, stemLike, destinationLike, limit, preference]
      : [vector, stemLike, destinationLike, limit];

    try {
      const rows: PlaceEmbeddingRow[] = await this.dataSource.query(
        `
        SELECT id,
               kakao_place_id,
               tourism_api_id,
               name,
               address,
               category,
               destination_region,
               coordinates,
               1 - (embedding <=> $1::vector) AS similarity,
               ${preferenceSelect}
        FROM place_embeddings
        WHERE embedding IS NOT NULL
          AND (
            destination_region IS NULL
            OR name ILIKE $3
            OR address ILIKE $3
            OR ($2 <> '' AND (region_sigungu ILIKE $2 OR destination_region ILIKE $2))
          )
        ORDER BY embedding <=> $1::vector
        LIMIT $4
        `,
        params,
      );

      return rows.flatMap((row) => this.toCandidate(row));
    } catch (error) {
      this.logger.warn(
        `pgvector place search failed, retrieval will fallback: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  async countSeededRegion(destination: string): Promise<number> {
    const region = normalizeDestinationRegion(destination);
    try {
      const rows: Array<{ count: string }> = await this.dataSource.query(
        'SELECT COUNT(*)::text AS count FROM place_embeddings WHERE lower(destination_region) = $1',
        [region],
      );
      return Number(rows[0]?.count ?? 0);
    } catch {
      return 0;
    }
  }

  async seedRegion(
    destination: string,
    embed: (text: string) => Promise<number[]>,
  ): Promise<number> {
    const region = normalizeDestinationRegion(destination);
    const seeds = getSeedPlaces(destination);
    let inserted = 0;

    for (const place of seeds) {
      const kakaoPlaceId = place.kakaoPlaceId ?? place.id;
      // seed 는 insert-only: 이미 있으면 건너뛴다.
      const existing = await this.findProvenance({
        kakaoPlaceId,
        tourismApiId: place.tourismApiId ?? null,
        region,
        name: place.name,
      });
      if (existing) continue;

      const embedding = await embed(buildPlaceEmbeddingText(place));
      await this.upsertPlace(
        {
          kakaoPlaceId,
          tourismApiId: place.tourismApiId ?? null,
          name: place.name,
          address: place.address,
          category: place.category,
          region,
          coordinates: place.coordinates,
        },
        embedding,
      );
      inserted += 1;
    }

    if (inserted > 0) {
      this.logger.log(`Seeded ${inserted} ${region} place embeddings for local CRAG retrieval`);
    }
    return inserted;
  }

  /**
   * 중복 판정 우선순위(kakao_place_id > tourism_api_id > (destination_region, name))로
   * 기존 행의 provenance(id·text_hash·embedding_model)를 조회한다. 없으면 null.
   * 적재 시 재임베딩 여부를 텍스트 해시·모델로 판단하는 데 쓴다.
   */
  async findProvenance(dedupe: PlaceDedupeKey): Promise<PlaceProvenance | null> {
    const clause = dedupe.kakaoPlaceId
      ? { sql: 'kakao_place_id = $1', params: [dedupe.kakaoPlaceId] }
      : dedupe.tourismApiId
        ? { sql: 'tourism_api_id = $1', params: [dedupe.tourismApiId] }
        : {
            sql: 'lower(destination_region) = $1 AND name = $2',
            params: [dedupe.region.toLowerCase(), dedupe.name],
          };

    const rows: Array<{ id: string; text_hash: string | null; embedding_model: string | null }> =
      await this.dataSource.query(
        `SELECT id, text_hash, embedding_model FROM place_embeddings WHERE ${clause.sql} LIMIT 1`,
        clause.params,
      );
    const row = rows[0];
    return row
      ? { id: row.id, textHash: row.text_hash, embeddingModel: row.embedding_model }
      : null;
  }

  /**
   * 장소 1건을 삽입하거나(existingId 없음) 갱신한다(existingId 있음).
   * 갱신 시 메타데이터·임베딩·provenance(text_hash·embedding_model·updated_at)를 모두 새로 쓴다.
   * → insert-only 였던 이전과 달리 텍스트/모델이 바뀐 행을 --reseed 없이 증분 갱신할 수 있다.
   */
  async upsertPlace(
    place: UpsertPlaceInput,
    embedding: number[],
    existingId?: string,
  ): Promise<void> {
    const vector = `[${embedding.join(',')}]`;

    if (existingId) {
      await this.dataSource.query(
        `
        UPDATE place_embeddings SET
          name = $2,
          address = $3,
          category = $4,
          destination_region = $5,
          region_sigungu = $6,
          coordinates = $7::jsonb,
          image_url = $8,
          embedding = $9::vector,
          text_hash = $10,
          embedding_model = $11,
          updated_at = NOW()
        WHERE id = $1
        `,
        [
          existingId,
          place.name,
          place.address ?? null,
          place.category ?? null,
          place.region,
          place.regionSigungu ?? null,
          JSON.stringify(place.coordinates),
          place.imageUrl ?? null,
          vector,
          place.textHash ?? null,
          place.embeddingModel ?? null,
        ],
      );
      return;
    }

    await this.dataSource.query(
      `
      INSERT INTO place_embeddings (
        kakao_place_id,
        tourism_api_id,
        name,
        address,
        category,
        destination_region,
        region_sigungu,
        coordinates,
        image_url,
        embedding,
        text_hash,
        embedding_model,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::vector, $11, $12, NOW())
      `,
      [
        place.kakaoPlaceId ?? null,
        place.tourismApiId ?? null,
        place.name,
        place.address ?? null,
        place.category ?? null,
        place.region,
        place.regionSigungu ?? null,
        JSON.stringify(place.coordinates),
        place.imageUrl ?? null,
        vector,
        place.textHash ?? null,
        place.embeddingModel ?? null,
      ],
    );
  }

  async countByRegion(region: string): Promise<number> {
    const rows: Array<{ count: string }> = await this.dataSource.query(
      'SELECT COUNT(*)::text AS count FROM place_embeddings WHERE lower(destination_region) = $1',
      [region.toLowerCase()],
    );
    return Number(rows[0]?.count ?? 0);
  }

  /**
   * 지역 place_embeddings 를 삭제한다 (재적재/임베딩 서버 전환 시 사용).
   * 적재가 저장한 원본 라벨(예: '서울특별시')과 seed catalog 의 정규화 라벨(예: 'seoul')을
   * 모두 지워 임베딩 공간을 깨끗하게 재생성할 수 있게 한다.
   */
  async deleteRegion(region: string): Promise<number> {
    const raw = region.toLowerCase();
    const normalized = normalizeDestinationRegion(region);
    const rows: Array<{ deleted: number }> = await this.dataSource.query(
      `DELETE FROM place_embeddings
       WHERE lower(destination_region) IN ($1, $2)
       RETURNING 1 AS deleted`,
      [raw, normalized],
    );
    return rows.length;
  }

  private toCandidate(row: PlaceEmbeddingRow): RawPlaceCandidate[] {
    const coordinates = this.parseCoordinates(row.coordinates);
    if (!coordinates) return [];

    const place = {
      id: row.id,
      ...(row.kakao_place_id ? { kakaoPlaceId: row.kakao_place_id } : {}),
      ...(row.tourism_api_id ? { tourismApiId: row.tourism_api_id } : {}),
      name: row.name,
      category: row.category ?? 'attraction',
      address: row.address ?? '',
      coordinates,
    };

    const similarity = this.numberOrUndefined(row.similarity);
    const preferenceSimilarity = this.numberOrUndefined(row.preference_similarity);
    return [
      {
        ...place,
        source: 'pgvector',
        tags: inferPlaceTags(place),
        ...(row.destination_region ? { destinationRegion: row.destination_region } : {}),
        ...(similarity !== undefined ? { similarity } : {}),
        ...(preferenceSimilarity !== undefined ? { preferenceSimilarity } : {}),
      },
    ];
  }

  private parseCoordinates(value: PlaceEmbeddingRow['coordinates']): Coordinates | null {
    if (!value) return null;
    const raw = typeof value === 'string' ? JSON.parse(value) as Partial<Coordinates> : value;
    const lat = Number(raw.lat);
    const lng = Number(raw.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }

  private numberOrUndefined(value: number | string | null | undefined): number | undefined {
    if (value === null || value === undefined) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
}
