export const TRIP_GENERATION_QUEUE = 'trip-generation';
export const GENERATE_TRIP_JOB = 'generate-trip';
export const TRIP_GENERATION_QUEUE_TIMEOUT_MS = 10_000;

export interface TripGenerationJobData {
  tripId: string;
  userId: string;
}

export interface TripGenerationJobResult {
  tripId: string;
  itemCount: number;
  skipped?: boolean;
}

export function tripGenerationJobId(tripId: string): string {
  return `trip-generation-${tripId}`;
}
