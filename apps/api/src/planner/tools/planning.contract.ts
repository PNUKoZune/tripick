import type { Coordinates, ItineraryItemDto, RouteMode } from '@tripick/types';
import type { SearchMetrics } from '../algorithm/local-search';

export const PLANNING_SCHEMA_VERSION = '1';
export const PLANNING_ALGORITHM_VERSION = 'same-day-local-search-v1';
export const PLANNING_CONSTRAINT_VERSION = 'constraint-engine-v2';
export const SNAPSHOT_TTL_SECONDS = 15 * 60;
export const MAX_PLANNING_ITEMS = 100;
export const MAX_ROUTE_LOOKUPS = 128;

export interface PlanningTrip {
  id: string;
  destination: string;
  startDate: string;
  endDate: string;
  wakeTime: string;
  sleepTime: string;
  transportMode: RouteMode;
}

export interface PlanningCandidate {
  id: string;
  template: ItineraryItemDto;
  preferenceScore: number | null;
  allowedDays: number[];
}

/** Stored only on the server. Client arguments never replace these constraints. */
export interface PlanningSnapshot {
  schemaVersion: string;
  algorithmVersion: string;
  constraintVersion: string;
  snapshotId: string;
  snapshotVersion: string;
  ownerId: string;
  createdAt: string;
  expiresAt: string;
  trip: PlanningTrip;
  items: ItineraryItemDto[];
  candidates: PlanningCandidate[];
  lockedItemIds: string[];
  requiredItemIds: string[];
  dailyTargets: Record<number, number>;
  origin?: Coordinates;
}

export interface PlanningIssue {
  code: string;
  message: string;
  itemId?: string;
  relatedItemId?: string;
}

export interface PlanningEvaluation {
  schemaVersion: string;
  algorithmVersion: string;
  constraintVersion: string;
  snapshotId: string;
  snapshotVersion: string;
  candidateId: string;
  valid: boolean;
  items: ItineraryItemDto[];
  normalizedItems: ItineraryItemDto[];
  normalizationChanges: Array<{
    itemId: string;
    field: string;
    before: string;
    after: string;
    reason: string;
  }>;
  metrics: SearchMetrics;
  violations: PlanningIssue[];
  unknownConstraints: PlanningIssue[];
  terminationReason: string;
  /** ETA may be a RouteHelper fallback; it is not proof of a live routing API call. */
  routeEvidence: 'route-helper';
}

export interface StoredPlanningCandidate {
  ownerId: string;
  snapshotId: string;
  snapshotVersion: string;
  evaluation: PlanningEvaluation;
}
