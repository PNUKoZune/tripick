import { readJson, removeStored, writeJson } from '@/shared/lib/storage';

const ACTIVE_TRIP_KEY = 'tripick.activeTripId.v1';

export function getActiveTripId(): string | null {
  return readJson<string>(ACTIVE_TRIP_KEY);
}

export function storeActiveTripId(tripId: string): void {
  writeJson(ACTIVE_TRIP_KEY, tripId);
}

export function clearActiveTripId(): void {
  removeStored(ACTIVE_TRIP_KEY);
}
