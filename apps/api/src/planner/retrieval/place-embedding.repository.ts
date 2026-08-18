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
import {
  KM_PER_LAT_DEGREE,
  KM_PER_LNG_DEGREE,
  SAME_PLACE_RADIUS_M,
  normalizeCatalogName,
} from './near-duplicate';
import {
  destinationRegionFilter,
  placeRegionCodes,
  sidoCodesForLabel,
  type RegionFilter,
} from './region-code';
import type { RawPlaceCandidate, VisitWindow } from './types';

/**
 * 후보 검색을 어디로 좁힐지.
 *
 * `region` 은 행정 경계 등가 비교(btree pre-filter), `anchor` 는 지점 반경 bbox 다.
 * 목적지가 행정구역이면 전자, '광안리'처럼 그보다 좁은 지점이면 후자를 쓴다 — 후자는
 * 경계를 넘는 후보를 자연스럽게 포함한다(광안리 앵커 반경에 남구·해운대구가 함께 들어온다).
 */
export type PlaceSearchScope =
  | { kind: 'region'; region: RegionFilter }
  | { kind: 'anchor'; center: Coordinates; radiusM: number };

/** Date → KST 기준 'YYYY-MM-DD'. 행사 기간은 날짜 단위라 시각·타임존을 여기서 떨군다. */
export function toKstDateString(date: Date): string {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export interface UpsertPlaceInput {
  kakaoPlaceId?: string | null;
  tourismApiId?: string | null;
  name: string;
  address?: string | null;
  category?: string | null;
  /**
   * 소스가 준 카테고리 상세 (KTO 유형명 '관광지' / 카카오 category_name 경로).
   * 임베딩 텍스트·태그 유추·검색 eligibility 판정이 모두 이 값을 보므로 저장해야 적재와 검색이 일치한다.
   */
  categoryDetail?: string | null;
  /** destination_region 컬럼에 저장할 지역 라벨 (예: '서울', 'seoul') */
  region: string;
  /** region_sigungu 컬럼에 저장할 시군구 라벨 (예: '경주시') */
  regionSigungu?: string | null;
  coordinates: Coordinates;
  imageUrl?: string | null;
  /** 'HH:MM-HH:MM' 영업시간 (KTO detailIntro2). 없으면 소비측이 제약 없음으로 처리한다. */
  openingHours?: string | null;
  /** 행사 시작일 'YYYY-MM-DD' (KTO 축제공연행사). NULL 이면 기간 없는 상시 장소. */
  eventStartDate?: string | null;
  /** 행사 종료일 'YYYY-MM-DD'. 여행 날짜가 이 뒤면 후보에서 빠진다. */
  eventEndDate?: string | null;
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
  /** 행사 기간도 임베딩 텍스트 밖이다. 연례 축제는 매년 날짜가 바뀌므로 비교가 특히 중요하다. */
  eventStartDate: string | null;
  eventEndDate: string | null;
  /**
   * 카테고리 상세는 임베딩 텍스트 **안**에 있지만(해시가 변화를 잡는다) 컬럼을 새로 추가했으므로
   * 기존 행은 NULL 이다. 해시가 같아 `unchanged` 로 떨어지는 행을 채우려면 값 비교가 필요하다.
   */
  categoryDetail: string | null;
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
  category_detail?: string | null;
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
    scope: PlaceSearchScope,
    limit: number,
    preferenceVector?: number[],
    visitWindow?: VisitWindow,
  ): Promise<RawPlaceCandidate[]> {
    const params: unknown[] = [`[${embedding.join(',')}]`];
    const regionClause = this.scopeClause(scope, params);
    const eventClause = this.eventPeriodClause(visitWindow, params);

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
               category_detail,
               destination_region,
               coordinates,
               image_url,
               opening_hours,
               1 - (embedding <=> $1::vector) AS similarity,
               ${preferenceSelect}
        FROM place_embeddings
        WHERE embedding IS NOT NULL
          ${regionClause}
          ${eventClause}
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
   * 기간 있는 행사(KTO 축제공연행사)를 **여행 날짜와 겹칠 때만** 남긴다.
   *
   * 축제는 장소가 아니라 이벤트다 — 적재 시점에 "끝난 것"만 빼면 오늘 적재한 8월 축제를
   * 10월 여행 후보로 내주게 된다. 판정은 반드시 소비 시점(여행 날짜)에 해야 한다.
   * 실측에서 `2025 영호남 전통시장 박람회`(2026년 8월 현재 종료)가 서면역·부산 결과에,
   * `해운대 모래축제`가 골든셋 busan-beach 상위 16 안에 올라왔다.
   *
   * NULL 은 **기간 없음 = 상시**다. 축제가 아닌 행(관광지·음식점·카페)이 전부 여기 해당하므로
   * 이 조건은 그들에게 아무 영향이 없다.
   *
   * 여행 날짜를 모르는 호출(스크립트·진단)은 오늘로 판정한다 — 이미 끝난 행사를 후보로
   * 내주지 않는 쪽이 안전한 기본값이다.
   */
  private eventPeriodClause(visitWindow: VisitWindow | undefined, params: unknown[]): string {
    const today = toKstDateString(new Date());
    const from = visitWindow?.from ?? today;
    const to = visitWindow?.to ?? from;
    params.push(from, to);
    const index = params.length - 1;
    return `AND (event_end_date IS NULL OR event_end_date >= $${index}::date)
          AND (event_start_date IS NULL OR event_start_date <= $${index + 1}::date)`;
  }

  /**
   * scope 를 WHERE 절 조각으로 바꾸고 바인딩을 `params` 에 밀어 넣는다.
   *
   * **지역 모드** — 정본 지역 코드 등가 비교. ILIKE 프리픽스였을 때는 인덱스를 못 타
   * (a) 전체 스캔이거나 (b) HNSW 근사 이웃을 뒤에서 걸러내는 post-filter 였고, 후자는 후보가
   * 통째로 탈락해 결과가 비었다. 등가 비교면 플래너가 btree(region_code/sigungu_code)로 먼저
   * 좁히고 정확 KNN 을 돌린다. 코드가 안 잡히는 목적지(자유 입력·해외)는 필터 없이 전역 검색,
   * 지역 라벨이 아예 없는 행(폴백 시드)은 어느 목적지에서도 후보로 남긴다.
   *
   * **앵커 모드** — bbox 로 좁히고 **정확 거리로 한 번 더 자른다**. 둘 다 필요하다:
   * bbox 는 `(lat, lng)` btree 를 타서 스캔을 없애고(실측 3km 질의 26.8ms → 0.8ms), 거리 조건은
   * 인덱스를 못 타는 대신 모서리를 깎는다.
   *
   * 모서리를 왜 깎아야 하나 — 외접 정사각형은 대각선이 반경의 1.41배라 "10km 반경"이 실제로는
   * 14km 까지 닿는다. 장소 밀도가 균일하지 않아서 이 차이가 면적비(1.27배)보다 훨씬 크게 터진다:
   * 에버랜드 10km 가 **원 15건 vs bbox 54건**이었고, 늘어난 39건은 대부분 북서쪽 모서리에 걸린
   * 분당이었다(실측 결과 1·2위가 분당 카페). 반경 확장 판정도 이 부풀린 수를 보고 "충분하다"고
   * 멈춰 버려, 지역 폴백이 떠야 할 케이스가 안 떴다.
   *
   * 거리식은 `near-duplicate` 의 평면 근사와 같은 상수를 쓴다 — 같은 좌표가 JS·SQL 두 곳에서
   * 다르게 판정되면 안 된다.
   */
  private scopeClause(scope: PlaceSearchScope, params: unknown[]): string {
    if (scope.kind === 'anchor') {
      const radiusKm = scope.radiusM / 1000;
      const latDelta = radiusKm / KM_PER_LAT_DEGREE;
      const lngDelta = radiusKm / KM_PER_LNG_DEGREE;
      params.push(
        scope.center.lat - latDelta,
        scope.center.lat + latDelta,
        scope.center.lng - lngDelta,
        scope.center.lng + lngDelta,
        scope.center.lat,
        scope.center.lng,
        radiusKm,
      );
      const box = params.length - 6;
      const center = params.length - 2;
      return `AND lat BETWEEN $${box} AND $${box + 1} AND lng BETWEEN $${box + 2} AND $${box + 3}
          AND sqrt(
                power((lat - $${center}) * ${KM_PER_LAT_DEGREE}, 2)
                + power((lng - $${center + 1}) * ${KM_PER_LNG_DEGREE}, 2)
              ) <= $${center + 2}`;
    }

    const unlabeled = '(region_code IS NULL AND sigungu_code IS NULL)';
    const { sido, sigungu } = scope.region;
    if (sido) {
      params.push(sido);
      return `AND (region_code = $${params.length} OR ${unlabeled})`;
    }
    if (sigungu) {
      params.push(sigungu);
      return `AND (sigungu_code = $${params.length} OR ${unlabeled})`;
    }
    return '';
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

  /**
   * 이 목적지 검색이 실제로 후보를 얻을 수 있는 행 수. **검색과 같은 정본 코드로 센다.**
   *
   * 예전 게이트(`countSeededRegion`)는 seed 슬러그 라벨(`destination_region='seoul'`)만 셌다.
   * 적재는 '서울특별시' 로 넣으므로 카탈로그가 1만 행 있어도 0 으로 보고 매번 시드를 주입했다.
   * 지역 라벨 없는 행(폴백 시드)은 세지 않는다 — 그 몇 건이 모든 지역을 '적재됨'으로 위장한다.
   * 지역 코드가 안 잡히는 목적지(자유 입력)는 0 — 그런 목적지에 넣을 지역 시드가 애초에 없다.
   */
  async countRegionCandidates(destination: string): Promise<number> {
    const { sido, sigungu } = destinationRegionFilter(destination);
    const column = sido ? 'region_code' : sigungu ? 'sigungu_code' : null;
    const code = sido ?? sigungu;
    if (!column || !code) return 0;
    try {
      const rows: Array<{ count: string }> = await this.dataSource.query(
        `SELECT COUNT(*)::text AS count FROM place_embeddings
         WHERE embedding IS NOT NULL AND ${column} = $1`,
        [code],
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
    // 폴백 시드(DEFAULT_SEEDS)는 DB 에 넣지 않는다 — 라벨이 'default' 라 region_code·sigungu_code
    // 가 둘 다 null 이 되고, 그러면 지역 필터의 unlabeled 예외로 **모든 목적지 검색**에 후보로
    // 남는다. 좌표도 서울 도심 고정이라 다른 지역 여행의 동선을 깨뜨린다. 카탈로그가 빈 목적지는
    // PlaceRetrievalService 의 인메모리 seed 폴백(getSeedCandidates)이 이미 커버한다.
    if (region === 'default') {
      this.logger.log(
        `[${destination}] 전용 seed 카탈로그가 없어 DB 시딩을 건너뜁니다 (검색 단계 인메모리 폴백 사용).`,
      );
      return 0;
    }
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
      category_detail: string | null;
      event_start_date: string | null;
      event_end_date: string | null;
    }> = await this.dataSource.query(
      // 날짜는 **문자로 읽는다** — pg 드라이버가 date 를 로컬 자정 Date 로 파싱해서 그대로
      // 비교하면 UTC 컨테이너에서 하루가 밀린다(이 저장소가 offsetDate 주석에 남긴 것과 같은 함정).
      `SELECT id, text_hash, embedding_model, opening_hours,
              to_char(event_start_date, 'YYYY-MM-DD') AS event_start_date,
              to_char(event_end_date, 'YYYY-MM-DD') AS event_end_date
       FROM place_embeddings WHERE ${clause.sql} LIMIT 1`,
      clause.params,
    );
    const row = rows[0];
    return row
      ? {
          id: row.id,
          textHash: row.text_hash,
          embeddingModel: row.embedding_model,
          openingHours: row.opening_hours,
          eventStartDate: row.event_start_date,
          eventEndDate: row.event_end_date,
          categoryDetail: row.category_detail,
        }
      : null;
  }

  /**
   * ID 가 다른 **같은 물리적 장소**의 기존 행을 이름+좌표로 찾는다. 없으면 null.
   *
   * 왜 필요한가 — 적재 dedupe(이름+좌표)는 **한 실행 안에서만** 돌고, DB 조회는 ID
   * (kakao_place_id / tourism_api_id)로만 한다. 그래서 KTO 가 먼저 넣은 장소를 다음 실행의
   * 카카오가 다른 ID 로 다시 넣어 같은 장소가 두 행이 됐다(실측 카탈로그에 250m 이내 동명 쌍
   * 138개, 거의 전부 소스 교차). 검색 단계 collapseNearDuplicates 가 접어 주므로 사용자에게는
   * 안 보이지만 카탈로그는 계속 커지고 후보 풀 자리를 나눠 쓴다.
   *
   * 거리 식은 near-duplicate 의 `metersBetween` 과 같은 평면 근사를 쓴다 — 같은 판정이
   * JS·SQL 두 곳에서 갈리지 않아야 한다.
   */
  async findSamePlace(
    name: string,
    coordinates: Coordinates,
  ): Promise<{ id: string; openingHours: string | null } | null> {
    const rows: Array<{ id: string; opening_hours: string | null }> = await this.dataSource.query(
      `SELECT id, opening_hours FROM (
         SELECT id,
                opening_hours,
                sqrt(
                  power((((coordinates->>'lat')::double precision) - $2) * 111000, 2)
                  + power((((coordinates->>'lng')::double precision) - $3) * 88000, 2)
                ) AS distance_m
         FROM place_embeddings
         WHERE replace(lower(name), ' ', '') = $1
           AND coordinates IS NOT NULL
       ) candidates
       WHERE distance_m <= $4
       ORDER BY distance_m
       LIMIT 1`,
      [normalizeCatalogName(name), coordinates.lat, coordinates.lng, SAME_PLACE_RADIUS_M],
    );
    const row = rows[0];
    return row ? { id: row.id, openingHours: row.opening_hours } : null;
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
   * 행사 기간만 갱신한다(재임베딩 없음). 영업시간과 같은 이유로 필요하다 — 기간은 임베딩 텍스트에
   * 들어가지 않아 텍스트 해시가 그대로면 증분 적재가 통째로 건너뛴다.
   *
   * 영업시간보다 더 자주 필요하다: **연례 축제는 같은 contentId 의 날짜가 매년 바뀐다.**
   * 이 경로가 없으면 작년 날짜가 박힌 채 영영 안 갱신돼 그 축제가 영구히 안 보이게 된다.
   */
  async updateEventPeriod(id: string, startDate: string, endDate: string): Promise<void> {
    await this.dataSource.query(
      'UPDATE place_embeddings SET event_start_date = $2, event_end_date = $3, updated_at = NOW() WHERE id = $1',
      [id, startDate, endDate],
    );
  }

  /**
   * 카테고리 상세만 갱신한다(재임베딩 없음). 이 컬럼은 나중에 추가돼 기존 행이 NULL 인데,
   * 임베딩 텍스트는 이미 그 값을 포함해 만들어졌으므로 해시가 같아 증분 적재가 건너뛴다.
   * 백필 1회를 위한 경로 — 그 뒤로는 텍스트 해시가 변화를 잡는다.
   */
  async updateCategoryDetail(id: string, categoryDetail: string): Promise<void> {
    await this.dataSource.query(
      'UPDATE place_embeddings SET category_detail = $2, updated_at = NOW() WHERE id = $1',
      [id, categoryDetail],
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
          event_start_date = $15,
          event_end_date = $16,
          category_detail = $17,
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
          place.eventStartDate ?? null,
          place.eventEndDate ?? null,
          place.categoryDetail ?? null,
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
        event_start_date,
        event_end_date,
        category_detail,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11::vector, $12, $13, $14, $15, $16, $17, $18, NOW())
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
        place.eventStartDate ?? null,
        place.eventEndDate ?? null,
        place.categoryDetail ?? null,
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
   *
   * **정본 코드(region_code)로도 함께 지운다** — 라벨만 보면 시군구 단위 타깃으로 적재된 행
   * ('속초'·'강릉')이 시도 어간('강원%')에 안 걸려 옛 모델 벡터로 남는다. 그 혼재를 막는 게
   * reseed 의 목적이므로 라벨 표기와 무관하게 그 시도 소재 행을 전부 지운다(이웃 지역 적재에서
   * 국경을 넘어 들어온 행도 포함 — 그 장소의 소재지가 이 시도라면 이 시도의 재적재 대상이다).
   * 시도로 안 잡히는 라벨(시군구 단위 타깃)은 코드가 없어 라벨 조건만 적용된다 — '속초' reseed 가
   * 강원 전체를 비우지 않는다.
   */
  async deleteRegion(region: string): Promise<number> {
    const raw = region.toLowerCase();
    // seed 슬러그 라벨('seoul'·'gyeongju')도 함께 지우되 'default' 는 제외한다 —
    // normalizeDestinationRegion 은 4개 슬러그 밖 지역을 전부 'default' 로 떨어뜨리므로
    // 그대로 쓰면 '강원특별자치도' reseed 가 다른 지역의 폴백 시드까지 지운다.
    const slug = normalizeDestinationRegion(region);
    const slugKey = slug === 'default' ? null : slug;
    const stem = regionPrefixStem(region).toLowerCase();
    const stemLike = stem ? `${stem}%` : null; // 어간이 비면(비정상 입력) 전체 삭제 방지 위해 미적용
    // 통합 라벨('전남광주통합특별시')은 두 시도를 포괄하므로 코드가 여러 개다.
    const codes = sidoCodesForLabel(region);
    const codeList = codes.length > 0 ? codes : null;
    // CTE 로 삭제 후 개수를 SELECT 한다. DELETE ... RETURNING 을 dataSource.query 로 직접 받으면
    // 드라이버가 [rows, affected] 형태를 돌려줘 rows.length 가 실제 삭제 수와 어긋난다.
    const rows: Array<{ count: string }> = await this.dataSource.query(
      `WITH deleted AS (
         DELETE FROM place_embeddings
         WHERE lower(destination_region) = $1
            OR ($2::text IS NOT NULL AND lower(destination_region) = $2)
            OR ($3::text IS NOT NULL AND lower(destination_region) LIKE $3)
            OR ($4::text[] IS NOT NULL AND region_code = ANY($4::text[]))
         RETURNING 1
       )
       SELECT COUNT(*)::text AS count FROM deleted`,
      [raw, slugKey, stemLike, codeList],
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
      ...(row.category_detail ? { categoryDetail: row.category_detail } : {}),
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
