import type { Coordinates, PlaceDto, ReplanTrigger, TasteTagDto } from '@tripick/types';

export type RetrievalSource = 'pgvector' | 'kakao' | 'seed';

export interface RawPlaceCandidate extends PlaceDto {
  source: RetrievalSource;
  tags?: string[];
  destinationRegion?: string;
  similarity?: number;
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
}

export interface CandidatePlace extends PlaceDto {
  source: RetrievalSource;
  tags: string[];
  confidence: number;
  reason: string;
  crag: CragScore;
  similarity?: number;
  distanceM?: number;
}

export interface RetrievalContext {
  userId: string;
  destination: string;
  tasteTags?: TasteTagDto;
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
