import type {
  CreateTripRequestDto,
  DestinationSuggestionDto,
  PlannerAlternativeResponseDto,
  PlannerSwapResponseDto,
  PlannerTripDto,
  TripSummaryDto,
} from '@tripick/types';

import { api } from '@/shared/lib';

export const DEMO_TRIP_ID = 'demo-gyeongju-1n2d';

export function fetchPlannerTrips() {
  return api.get<TripSummaryDto[]>('/main-planner/trips');
}

export function fetchPlannerTrip(tripId: string) {
  return api.get<PlannerTripDto>(`/main-planner/trips/${tripId}`);
}

export function fetchPlannerAlternatives(tripId: string, itemId: string) {
  return api.get<PlannerAlternativeResponseDto>(
    `/main-planner/trips/${tripId}/items/${itemId}/alternatives`,
  );
}

export function swapPlannerItem(
  tripId: string,
  body: { itemId: string; alternativeId: string },
) {
  return api.post<PlannerSwapResponseDto>(`/main-planner/trips/${tripId}/swap`, body);
}

export function fetchDestinationSuggestions(query: string) {
  const search = query ? `?q=${encodeURIComponent(query)}` : '';
  return api.get<DestinationSuggestionDto[]>(`/main-planner/destinations${search}`);
}

export function createTrip(body: CreateTripRequestDto) {
  return api.post<TripSummaryDto>('/main-planner/trips', body);
}
