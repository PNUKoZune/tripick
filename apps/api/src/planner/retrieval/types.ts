import type { Coordinates, PlaceDto, ReplanTrigger, TasteTagDto } from '@tripick/types';
import type { RegionFilter } from './region-code';

export type RetrievalSource = 'pgvector' | 'kakao' | 'seed';

/**
 * 후보 풀이 종류별로 반드시 담아야 하는 최소 수.
 *
 * 예전엔 식음(restaurant+cafe)을 한 덩어리로 묶어 "2개"만 보장했다. 카탈로그 비중이
 * 음식점 15,854 대 카페 2,591(해운대 반경 5km 는 119 대 31)이라 그 2자리는 거의 항상
 * 음식점이 가져갔고, **카페 하한은 어디에도 없었다** — 일정에 카페가 한 번도 안 들어오던 원인.
 *
 * 값은 호출자(플래너)가 일차 수만큼 곱해서 넘긴다. 하루에 필요한 건 끼니 2 + 휴식 1 이다.
 */
export interface PoolCategoryQuota {
  restaurant: number;
  cafe: number;
  attraction: number;
}

/** 후보를 방문할 날짜 구간 (KST 기준 'YYYY-MM-DD', 양끝 포함). */
export interface VisitWindow {
  from: string;
  to: string;
}

/**
 * 행정구역보다 좁은 목적지('광안리'·'서면역'·'남이섬')를 좌표로 해석한 결과.
 *
 * 왜 필요한가 — 지역 필터는 시도·시군구 코드 등가 비교라 그 둘 중 어느 것도 아닌 입력은
 * 존재하지 않는 코드('광안리')를 만들어 후보가 **0건**이 된다. 그런 목적지는 행정 경계가
 * 아니라 "그 지점 주변"이 사용자가 말한 범위이므로 좌표를 기준으로 잡는다.
 */
export interface DestinationAnchor {
  coordinates: Coordinates;
  /** 앵커를 만든 카카오 장소명 (로그·추적용) */
  label: string;
  /** 앵커 주소에서 파생한 정본 지역 코드. 반경 검색으로 풀을 못 채웠을 때의 폴백 범위. */
  region: RegionFilter;
}

/** 후보 풀을 확정한 뒤의 앵커 — 실제로 쓴 반경이 붙는다. */
export interface AnchoredScope extends DestinationAnchor {
  radiusM: number;
}

/**
 * 네이버 블로그·카페 검색 코퍼스로 만든 "대중 인지도" 조회 인터페이스.
 * 후보 장소명이 추천 글에 얼마나 언급되는지로 마이너/유명을 가른다.
 * 비활성(키 없음·조회 실패) 시 evaluator 가 중립값을 써 랭킹을 바꾸지 않는다.
 */
export interface PopularityIndex {
  /** 장소명이 코퍼스에 등장한 횟수 */
  mentions(name: string): number;
  /** 언급 빈도를 0~1 로 정규화한 점수 (언급 0 이면 낮은 값) */
  score(name: string): number;
  /** 코퍼스를 이룬 블로그+카페 문서 수 */
  readonly docCount: number;
}

export interface RawPlaceCandidate extends PlaceDto {
  source: RetrievalSource;
  tags?: string[];
  /** 원본 카테고리 상세 (카카오 category_name 경로 등). 임베딩 텍스트 강화용 */
  categoryDetail?: string;
  destinationRegion?: string;
  similarity?: number;
  /** 저장된 사용자 취향 벡터와의 코사인 유사도 (pgvector 후보만) */
  preferenceSimilarity?: number;
  distanceM?: number;
}

export interface CragScore {
  total: number;
  retrieval: number;
  taste: number;
  locality: number;
  context: number;
  availability: number;
  matchedTags: string[];
  penalties: string[];
  /** 취향 벡터 기반 개인화 점수 (0~1). 벡터가 없으면 undefined */
  personalization?: number;
  /** 네이버 추천 글 대중 인지도 점수 (0~1). 인덱스 비활성이면 중립값 */
  popularity: number;
}

export interface CandidatePlace extends PlaceDto {
  source: RetrievalSource;
  tags: string[];
  confidence: number;
  reason: string;
  crag: CragScore;
  similarity?: number;
  preferenceSimilarity?: number;
  distanceM?: number;
}

export interface RetrievalContext {
  userId: string;
  destination: string;
  tasteTags?: TasteTagDto;
  /** 저장된 사용자 취향 임베딩 (preference_embeddings). 검색 개인화에 사용 */
  preferenceVector?: number[];
  trigger?: ReplanTrigger;
  currentLocation?: Coordinates;
  notes?: string | null;
  limit?: number;
  startAt?: Date;
  /**
   * 후보를 **방문할 날짜 구간**. 기간 있는 행사(축제)를 여행 날짜와 겹칠 때만 남기는 데 쓴다.
   *
   * `startAt` 과 별개인 이유 — `startAt` 은 "그 시각에 문을 여는가"(영업시간·가용성 점수)를 보는
   * 시각이고, 이건 "그 날짜에 열리는 행사인가"를 보는 날짜 구간이다. 일자별 검색은 하루짜리
   * 구간이지만 `startAt` 은 첫 일차 기준으로 공유되므로, 하나로 합치면 둘 중 하나가 틀어진다.
   */
  visitWindow?: VisitWindow;
  /** 목적지 네이버 추천 글 기반 대중 인지도 인덱스 (place-retrieval 이 앞단에서 주입) */
  popularityIndex?: PopularityIndex;
  /**
   * 목적지 앵커 (place-retrieval 이 앞단에서 주입). 행정구역으로 안 잡히는 목적지에만 붙는다.
   * 카카오 폴백은 이걸 검색 중심으로 쓴다.
   */
  anchor?: AnchoredScope;
  /**
   * 이 검색이 채워야 할 종류별 최소 후보 수. 플래너가 "일차 수 × 하루에 필요한 슬롯" 으로
   * 계산해 넘긴다. 생략하면 하루치 기본값(끼니 2 · 카페 1 · 볼거리 2).
   *
   * 검색 단독으로는 알 수 없는 값이라 컨텍스트로 받는다 — limit 만 보고 역산하면 부분 재계획
   * (1일차만)과 5일 여행이 같은 하한을 쓰게 된다.
   */
  categoryQuota?: PoolCategoryQuota;
  /**
   * 목적지에서 해석한 정본 지역 코드 (place-retrieval 이 앞단에서 주입).
   *
   * 소비측이 `destination` 문자열에서 각자 재계산하면 앵커로 알아낸 지역('광안리'→부산)을
   * 못 보고 원래의 죽은 코드로 되돌아간다. 없으면 `destinationRegionFilter` 로 폴백한다.
   */
  regionFilter?: RegionFilter;
}

export interface RetrievalTrace {
  queryText: string;
  sources: RetrievalSource[];
  fallbackUsed: boolean;
  averageConfidence: number;
  rejectedCount: number;
  /** 질의 임베딩 출처. hash 면 pgvector 경로를 사용하지 않았음을 뜻한다. */
  embeddingSource?: 'remote' | 'hash';
  /** 질의 벡터 공간 식별자. 장애·모델 교체 시 검색 결과를 진단하는 저카디널리티 필드. */
  embeddingModel?: string;
}

export interface RetrievalResult {
  places: CandidatePlace[];
  trace: RetrievalTrace;
}
