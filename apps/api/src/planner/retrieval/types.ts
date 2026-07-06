import type { Coordinates, PlaceDto, ReplanTrigger, TasteTagDto } from '@tripick/types';

export type RetrievalSource = 'pgvector' | 'kakao' | 'seed';

export interface RawPlaceCandidate extends PlaceDto {
  source: RetrievalSource;
  tags?: string[];
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
