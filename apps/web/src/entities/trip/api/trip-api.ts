import type { CreateTripDto, TripDto } from '@tripick/types';
import { api } from '@/shared/api/client';
import { getActiveTripId, storeActiveTripId } from '../model/active-trip-storage';

const DEFAULT_TRIP: CreateTripDto = {
  title: '경주 1박 2일 취향 여행',
  destination: '경주',
  startDate: '2026-05-23',
  endDate: '2026-05-24',
  wakeTime: '07:30',
  sleepTime: '23:00',
  transportMode: 'transit',
};

export function getTrips(token: string) {
  return api.get<TripDto[]>('/trips', token);
}

export function createTrip(token: string, dto: CreateTripDto = DEFAULT_TRIP) {
  return api.post<TripDto>('/trips', dto, token);
}

export async function ensureActiveTrip(token: string): Promise<TripDto> {
  const trips = await getTrips(token);
  const activeTripId = getActiveTripId();
  const activeTrip = trips.find((trip) => trip.id === activeTripId);
  if (activeTrip) {
    return activeTrip;
  }

  const fallbackTrip = trips[0];
  if (fallbackTrip) {
    storeActiveTripId(fallbackTrip.id);
    return fallbackTrip;
  }

  const createdTrip = await createTrip(token);
  storeActiveTripId(createdTrip.id);
  return createdTrip;
}
