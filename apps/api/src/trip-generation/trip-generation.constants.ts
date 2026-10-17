export const TRIP_GENERATION_QUEUE = 'trip-generation';
export const GENERATE_TRIP_JOB = 'generate-trip';
export const TRIP_GENERATION_QUEUE_TIMEOUT_MS = 10_000;

export interface TripGenerationJobData {
  tripId: string;
  userId: string;
  /** Immutable request identity; each explicit retry has a different BullMQ id. */
  generationId?: string;
}

export interface TripGenerationJobResult {
  tripId: string;
  itemCount: number;
  skipped?: boolean;
}

export function tripGenerationJobId(tripId: string, generationId?: string): string {
  return `trip-generation-${generationId ?? tripId}`;
}
