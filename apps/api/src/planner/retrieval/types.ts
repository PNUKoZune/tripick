import type { Coordinates, PlaceDto, ReplanTrigger, TasteTagDto } from '@tripick/types';

export type RetrievalSource = 'pgvector' | 'kakao' | 'seed';

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
  dataQuality: number;
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
  /** 목적지 네이버 추천 글 기반 대중 인지도 인덱스 (place-retrieval 이 앞단에서 주입) */
  popularityIndex?: PopularityIndex;
}

export interface RetrievalTrace {
  queryText: string;
  sources: RetrievalSource[];
  fallbackUsed: boolean;
  averageConfidence: number;
  rejectedCount: number;
}

export interface RetrievalResult {
  places: CandidatePlace[];
  trace: RetrievalTrace;
}
