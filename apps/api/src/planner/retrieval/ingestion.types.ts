import type { Coordinates } from '@tripick/types';

/**
 * 적재 소스.
 * - `tour`   KTO areaBasedList2 — 지역 전역을 넓게 채우는 기본 카탈로그
 * - `kakao`  KTO 좌표 앵커 주변 카테고리 검색 — 카카오 전용 장소(카페·프랜차이즈) 보강
 * - `popular` 네이버 추천 글 언급 → 카카오 정규화 — 대표 명소·맛집만 뽑는 얕고 정확한 패스
 * - `keyword` 운영자가 이름을 직접 지정 → 카카오 키워드 검색 — 위 셋이 구조적으로 못 닿는 장소용
 */
export type IngestSource = 'kakao' | 'tour' | 'popular' | 'keyword';

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
  /** 'HH:MM-HH:MM' 정규화 영업시간 (KTO detailIntro2). 카카오 소스는 제공하지 않아 비어 있다. */
  openingHours?: string;
  /**
   * 행사 시작일 'YYYY-MM-DD' (KTO 축제공연행사만). 없으면 상시 운영 장소다.
   * 목록 API(areaBasedList2)는 기간을 안 주므로 searchFestival2 로 따로 조달한다.
   */
  eventStartDate?: string;
  /** 행사 종료일 'YYYY-MM-DD'. 이 날짜가 지난 행사는 검색에서 제외된다. */
  eventEndDate?: string;
  source: IngestSource;
}

export interface IngestRegionResult {
  region: string;
  fetched: number;
  deduped: number;
  /** 신규 삽입 */
  inserted: number;
  /** 내용/모델이 바뀌어 재임베딩·갱신 */
  updated: number;
  /** 텍스트 해시·모델 동일해 재임베딩 없이 유지 */
  unchanged: number;
  /** ID 는 다르지만 이름+좌표가 같은 기존 행이 있어 새 행을 만들지 않은 건수 (소스 간 중복) */
  duplicates: number;
  /** reseed 시 적재 전 삭제한 기존 벡터 수 */
  deleted: number;
}

export interface IngestSummary {
  regions: IngestRegionResult[];
  totalFetched: number;
  totalInserted: number;
  totalUpdated: number;
  totalUnchanged: number;
  totalDuplicates: number;
  totalDeleted: number;
}
