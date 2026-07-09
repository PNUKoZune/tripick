import type { Coordinates } from '@tripick/types';

export type IngestSource = 'kakao' | 'tour';

/** 적재 파이프라인이 다루는 정규화된 장소. place_embeddings 컬럼과 1:1 대응. */
export interface IngestPlace {
  kakaoPlaceId?: string;
  tourismApiId?: string;
  name: string;
  category: string;
  /** 원본 카테고리 상세 (카카오 category_name 경로 / KTO 콘텐츠 유형명). 임베딩 텍스트 강화용 */
  categoryDetail?: string;
  address: string;
  coordinates: Coordinates;
  /** destination_region 라벨 (시도명, 예: '서울') */
  region: string;
  /** 시군구 라벨 (예: '경주시'). 시/군 단위 정밀 필터용 */
  sigungu?: string;
  imageUrl?: string;
  source: IngestSource;
}

export interface IngestRegionResult {
  region: string;
  fetched: number;
  deduped: number;
  inserted: number;
  skipped: number;
  /** reseed 시 적재 전 삭제한 기존 벡터 수 */
  deleted: number;
}

export interface IngestSummary {
  regions: IngestRegionResult[];
  totalFetched: number;
  totalInserted: number;
  totalDeleted: number;
}
