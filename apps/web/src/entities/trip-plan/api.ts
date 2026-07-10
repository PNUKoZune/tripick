import type {
  AddTripMemberRequestDto,
  CreateTripRequestDto,
  DestinationSuggestionDto,
  PlannerAlternativeResponseDto,
  PlannerCoordinationDto,
  PlannerMemberDto,
  PlannerResolvePlaceResponseDto,
  PlannerSwapPlaceDto,
  PlannerSwapResponseDto,
  PlannerTripDto,
  ReplanJobDto,
  ReplanRequestDto,
  TripSummaryDto,
} from '@tripick/types';

import { api } from '@/shared/lib';

export function fetchPlannerTrips() {
  return api.get<TripSummaryDto[]>('/main-planner/trips');
}

export function fetchPlannerTrip(tripId: string) {
  return api.get<PlannerTripDto>(`/main-planner/trips/${tripId}`);
}

export function fetchPlannerAlternatives(tripId: string, itemId: string, query?: string) {
  const search = query?.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
  return api.get<PlannerAlternativeResponseDto>(
    `/main-planner/trips/${tripId}/items/${itemId}/alternatives${search}`,
  );
}

/** 장소 이름(지도 링크도 허용) → 카카오 Local 실제 장소 1곳 해석 (확인용) */
export function resolvePlannerPlace(tripId: string, itemId: string, query: string) {
  return api.post<PlannerResolvePlaceResponseDto>(
    `/main-planner/trips/${tripId}/items/${itemId}/resolve-place`,
    { query },
  );
}

export function swapPlannerItem(
  tripId: string,
  body: { itemId: string; place: PlannerSwapPlaceDto },
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

export function acceptTripInvite(tripId: string, memberId: string) {
  return api.patch<PlannerMemberDto>(
    `/main-planner/trips/${tripId}/members/${memberId}/accept-invite`,
    {},
  );
}

export function rejectTripInvite(tripId: string, memberId: string) {
  return api.delete<void>(`/main-planner/trips/${tripId}/members/${memberId}/invite`);
}

export function fetchPlannerCoordination(tripId: string) {
  return api.get<PlannerCoordinationDto>(`/main-planner/trips/${tripId}/coordination`);
}

/** 경로 이탈 신고 → 재계획 트리거 (BullMQ 잡 등록) */
export function reportTripDeviation(body: ReplanRequestDto) {
  return api.post<ReplanJobDto>('/alternative/deviation', body);
}

/** 대안 팝업 자유 텍스트 요청 → 재계획 트리거 (manual, BullMQ 잡 등록) */
export function requestTripReplan(body: ReplanRequestDto) {
  return api.post<ReplanJobDto>('/alternative/request', body);
}
