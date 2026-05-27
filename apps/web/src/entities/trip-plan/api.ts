import type {
  AddTripMemberRequestDto,
  CreateTripRequestDto,
  DestinationSuggestionDto,
  PlannerAlternativeResponseDto,
  PlannerCoordinationDto,
  PlannerMemberDto,
  PlannerSwapResponseDto,
  PlannerTripDto,
  TripSummaryDto,
} from '@tripick/types';

import { api } from '@/shared/lib';

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

export function addTripMember(tripId: string, body: AddTripMemberRequestDto) {
  return api.post<PlannerMemberDto[]>(`/main-planner/trips/${tripId}/members`, body);
}

export function removeTripMember(tripId: string, memberId: string) {
  return api.delete<PlannerMemberDto[]>(`/main-planner/trips/${tripId}/members/${memberId}`);
}

export function fetchPlannerCoordination(tripId: string) {
  return api.get<PlannerCoordinationDto>(`/main-planner/trips/${tripId}/coordination`);
}
