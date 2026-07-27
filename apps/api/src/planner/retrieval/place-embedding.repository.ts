import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Coordinates } from '@tripick/types';
import {
  buildPlaceEmbeddingText,
  getSeedPlaces,
  inferPlaceTags,
  normalizeDestinationRegion,
  regionPrefixStem,
} from './place-seeds';
import { destinationRegionFilter, placeRegionCodes } from './region-code';
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
  /** 'HH:MM-HH:MM' 영업시간 (KTO detailIntro2). 없으면 소비측이 제약 없음으로 처리한다. */
  openingHours?: string | null;
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
  /** 영업시간은 임베딩 텍스트에 없어 해시로 변화를 감지할 수 없다. 값 비교용으로 함께 읽는다. */
  openingHours: string | null;
}

/** 취향 벡터 기반 지역 추천 1건. */
export interface RegionRecommendation {
  /** place_embeddings.destination_region 원본 값 (시도명 또는 정규화 슬러그) */
  region: string;
  /** place_embeddings.region_sigungu 원본 값 (시/군/구, 없으면 null) */
  sigungu: string | null;
  /** 상위 topK 장소의 취향 코사인 평균 (0~1) */
  score: number;
  /** 점수 계산에 쓴 장소 수 */
  places: number;
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
  image_url?: string | null;
  opening_hours?: string | null;
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
    // 목적지를 정본 지역 코드로 바꿔 등가 비교로 pre-filter 한다.
    // ILIKE 프리픽스였을 때는 인덱스를 못 타 (a) 전체 스캔이거나 (b) HNSW 근사 이웃을
    // 뒤에서 걸러내는 post-filter 였고, 후자는 후보가 통째로 탈락해 결과가 비었다.
    // 등가 비교면 플래너가 btree(region_code/sigungu_code)로 먼저 좁히고 정확 KNN 을 돌린다.
    // 예: '경주'→sigungu '경주', '부산 해운대구'→sido '부산', '경상북도'→sido '경북'.
    const { sido, sigungu } = destinationRegionFilter(destination);
    const params: unknown[] = [`[${embedding.join(',')}]`];

    // 지역 코드가 안 잡히는 목적지(자유 입력·해외)는 필터 없이 전역 검색으로 둔다.
    // 지역 라벨이 아예 없는 행(폴백 시드)은 어느 목적지에서도 후보로 남긴다.
    const unlabeled = '(region_code IS NULL AND sigungu_code IS NULL)';
    let regionClause = '';
    if (sido) {
      params.push(sido);
      regionClause = `AND (region_code = $${params.length} OR ${unlabeled})`;
    } else if (sigungu) {
      params.push(sigungu);
      regionClause = `AND (sigungu_code = $${params.length} OR ${unlabeled})`;
    }

    params.push(limit);
    const limitIndex = params.length;

    // 취향 벡터가 있으면 후보별 취향 코사인을 SQL 에서 함께 계산해 리랭킹 신호로 사용
    const hasPreference = Array.isArray(preferenceVector) && preferenceVector.length > 0;
    let preferenceSelect = 'NULL AS preference_similarity';
    if (hasPreference) {
      params.push(`[${preferenceVector!.join(',')}]`);
      preferenceSelect = `1 - (embedding <=> $${params.length}::vector) AS preference_similarity`;
    }

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
               image_url,
               opening_hours,
               1 - (embedding <=> $1::vector) AS similarity,
               ${preferenceSelect}
        FROM place_embeddings
        WHERE embedding IS NOT NULL
          ${regionClause}
        ORDER BY embedding <=> $1::vector
        LIMIT $${limitIndex}
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

  /**
   * 취향 벡터로 목적지를 랭킹한다. 시군구(region_sigungu)가 있으면 시/군/구 단위로,
   * 없으면 시도(destination_region) 단위로 묶어(가능한 가장 세밀한 단위) 상위 topK개
   * 장소의 취향 코사인 평균을 점수로 쓴다. (region, sigungu) 조합으로 그룹핑하므로
   * 서로 다른 시도의 동명 시군구('중구' 등)는 별개로 유지된다.
   * 벡터 차원 불일치 등 실패 시 [] 를 반환해 호출부가 인기순으로 폴백하게 한다.
   */
  async recommendRegions(
    preferenceVector: number[],
    topK: number,
    minPlaces: number,
    limit: number,
  ): Promise<RegionRecommendation[]> {
    if (preferenceVector.length === 0) return [];
    const vector = `[${preferenceVector.join(',')}]`;
    try {
      const rows: Array<{ region: string; sigungu: string | null; score: string; places: string }> =
        await this.dataSource.query(
          `
          WITH scored AS (
            SELECT destination_region AS region,
                   region_sigungu AS sigungu,
                   1 - (embedding <=> $1::vector) AS sim,
                   ROW_NUMBER() OVER (
                     PARTITION BY destination_region, region_sigungu
                     ORDER BY embedding <=> $1::vector
                   ) AS rnk
            FROM place_embeddings
            WHERE embedding IS NOT NULL
              AND destination_region IS NOT NULL
              AND destination_region <> 'default'
          )
          SELECT region, sigungu, AVG(sim) AS score, COUNT(*) AS places
          FROM scored
          WHERE rnk <= $2
          GROUP BY region, sigungu
          HAVING COUNT(*) >= $3
          ORDER BY score DESC
          LIMIT $4
          `,
          [vector, topK, minPlaces, limit],
        );
      return rows.map((row) => ({
        region: row.region,
        sigungu: row.sigungu,
        score: Number(row.score),
        places: Number(row.places),
      }));
    } catch (error) {
      this.logger.warn(
        `region recommendation failed, falling back to popular: ${error instanceof Error ? error.message : String(error)}`,
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
          openingHours: place.openingHours ?? null,
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

    const rows: Array<{
      id: string;
      text_hash: string | null;
      embedding_model: string | null;
      opening_hours: string | null;
    }> = await this.dataSource.query(
      `SELECT id, text_hash, embedding_model, opening_hours FROM place_embeddings WHERE ${clause.sql} LIMIT 1`,
      clause.params,
    );
    const row = rows[0];
    return row
      ? {
          id: row.id,
          textHash: row.text_hash,
          embeddingModel: row.embedding_model,
          openingHours: row.opening_hours,
        }
      : null;
  }

  /**
   * 영업시간만 갱신한다(재임베딩 없음). 영업시간은 임베딩 텍스트에 들어가지 않으므로
   * 텍스트 해시가 그대로인 기존 행은 증분 적재에서 건너뛰어져 값이 영영 안 채워진다.
   * 그 행들을 --reseed(전량 재임베딩) 없이 채우기 위한 경로.
   */
  async updateOpeningHours(id: string, openingHours: string | null): Promise<void> {
    await this.dataSource.query(
      'UPDATE place_embeddings SET opening_hours = $2, updated_at = NOW() WHERE id = $1',
      [id, openingHours],
    );
  }

  /**
   * 카카오 장소 ID 로 적재된 영업시간을 조회한다. 사용자가 지도에서 고른 장소를 일정에
   * 수동 추가할 때, 이미 적재된 값이 있으면 외부 API 왕복 없이 재사용하기 위한 경로.
   * 적재 안 됐거나 영업시간이 없으면 null.
   */
  async findOpeningHoursByKakaoId(kakaoPlaceId: string): Promise<string | null> {
    try {
      const rows: Array<{ opening_hours: string | null }> = await this.dataSource.query(
        'SELECT opening_hours FROM place_embeddings WHERE kakao_place_id = $1 LIMIT 1',
        [kakaoPlaceId],
      );
      return rows[0]?.opening_hours ?? null;
    } catch (error) {
      this.logger.warn(
        `opening_hours lookup by kakaoPlaceId failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
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

    // 라벨(destination_region·region_sigungu)은 소스 표기 그대로 남기고,
    // 검색 필터가 쓰는 정본 코드를 여기서 함께 파생해 둔다 — 질의 쪽도 같은 함수로 계산하므로
    // 라벨 표기가 섞여 있어도('경상북도'/'경북'/'gyeongbuk') 한 코드로 만난다.
    const { regionCode, sigunguCode } = placeRegionCodes(
      place.region,
      place.regionSigungu,
      place.address,
    );

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
          opening_hours = $9,
          embedding = $10::vector,
          text_hash = $11,
          embedding_model = $12,
          region_code = $13,
          sigungu_code = $14,
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
          place.openingHours ?? null,
          vector,
          place.textHash ?? null,
          place.embeddingModel ?? null,
          regionCode,
          sigunguCode,
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
        opening_hours,
        embedding,
        text_hash,
        embedding_model,
        region_code,
        sigungu_code,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11::vector, $12, $13, $14, $15, NOW())
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
        place.openingHours ?? null,
        vector,
        place.textHash ?? null,
        place.embeddingModel ?? null,
        regionCode,
        sigunguCode,
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
   * 라벨 표기가 섞여 있어도(옛 단축명 '대구' vs 새 법정동 풀네임 '대구광역시' vs seed 슬러그 'daegu')
   * 어간 프리픽스로 함께 지워 임베딩 공간을 깨끗하게 재생성한다.
   * 예: region='대구광역시' → 어간 '대구' → '대구%' 로 '대구'·'대구광역시' 모두 삭제.
   */
  async deleteRegion(region: string): Promise<number> {
    const raw = region.toLowerCase();
    const normalized = normalizeDestinationRegion(region);
    const stem = regionPrefixStem(region).toLowerCase();
    const stemLike = stem ? `${stem}%` : null; // 어간이 비면(비정상 입력) 전체 삭제 방지 위해 미적용
    // CTE 로 삭제 후 개수를 SELECT 한다. DELETE ... RETURNING 을 dataSource.query 로 직접 받으면
    // 드라이버가 [rows, affected] 형태를 돌려줘 rows.length 가 실제 삭제 수와 어긋난다.
    const rows: Array<{ count: string }> = await this.dataSource.query(
      `WITH deleted AS (
         DELETE FROM place_embeddings
         WHERE lower(destination_region) = $1
            OR lower(destination_region) = $2
            OR ($3::text IS NOT NULL AND lower(destination_region) LIKE $3)
         RETURNING 1
       )
       SELECT COUNT(*)::text AS count FROM deleted`,
      [raw, normalized, stemLike],
    );
    return Number(rows[0]?.count ?? 0);
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
      ...(row.image_url ? { imageUrl: row.image_url } : {}),
      ...(row.opening_hours ? { openingHours: row.opening_hours } : {}),
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
