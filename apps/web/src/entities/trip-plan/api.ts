import type {
  AddTripMemberRequestDto,
  CreateTripRequestDto,
  DestinationSuggestionDto,
  PlannerAddItemRequestDto,
  PlannerAlternativeResponseDto,
  PlannerCoordinationDto,
  PlannerItineraryItemDto,
  PlannerMemberDto,
  PlannerReorderItemsRequestDto,
  PlannerResolvePlaceResponseDto,
  PlannerSwapPlaceDto,
  PlannerSwapResponseDto,
  PlannerTripDto,
  PlannerUpdateItemRequestDto,
  PlannerWeatherDto,
  ReplanJobDto,
  ReplanRequestDto,
  SharedItineraryDto,
  TripShareResponseDto,
  TripSummaryDto,
  UpdateLiveLocationDto,
} from '@tripick/types';

import { api } from '@/shared/lib';

export function fetchPlannerTrips() {
  return api.get<TripSummaryDto[]>('/main-planner/trips');
}

export function fetchPlannerTrip(tripId: string) {
  return api.get<PlannerTripDto>(`/main-planner/trips/${tripId}`);
}

/**
 * 일자별 날씨. 상세 조회에 싣지 않고 따로 받는다 — 기상청이 느리거나 막혀도
 * 일정 화면이 그 대기에 묶이지 않아야 한다.
 */
export function fetchPlannerTripWeather(tripId: string) {
  return api.get<PlannerWeatherDto[]>(`/main-planner/trips/${tripId}/weather`);
}

export function fetchPlannerAlternatives(tripId: string, itemId: string, note?: string) {
  const search = note?.trim() ? `?note=${encodeURIComponent(note.trim())}` : '';
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

/** 취향 기반 추천 여행지 (취향 벡터 없으면 서버가 인기순으로 폴백) */
export function fetchRecommendedDestinations() {
  return api.get<DestinationSuggestionDto[]>('/main-planner/destinations/recommended');
}

export function createTrip(body: CreateTripRequestDto) {
  return api.post<TripSummaryDto>('/main-planner/trips', body);
}

/** 여행 삭제 (owner 만) */
export function deleteTrip(tripId: string) {
  return api.delete<void>(`/trips/${tripId}`);
}

/** 공유 링크 상태 조회 (owner) */
export function fetchTripShareStatus(tripId: string) {
  return api.get<{ token: string | null }>(`/main-planner/trips/${tripId}/share`);
}

/** 공유 링크 활성화 (owner) */
export function enableTripShare(tripId: string) {
  return api.post<TripShareResponseDto>(`/main-planner/trips/${tripId}/share`, {});
}

/** 공유 링크 비활성화 (owner) */
export function disableTripShare(tripId: string) {
  return api.delete<void>(`/main-planner/trips/${tripId}/share`);
}

/** 공개 공유 토큰으로 읽기 전용 일정 조회 (인증 불필요) */
export function fetchSharedItinerary(token: string) {
  return api.get<SharedItineraryDto>(`/shared-itineraries/${token}`);
}

/** 일정 항목 수동 추가 */
export function addItineraryItem(tripId: string, body: PlannerAddItemRequestDto) {
  return api.post<PlannerItineraryItemDto>(`/main-planner/trips/${tripId}/items`, body);
}

/** 일정 항목 수정 (시간·메모·이름·체류시간) */
export function updateItineraryItem(
  tripId: string,
  itemId: string,
  body: PlannerUpdateItemRequestDto,
) {
  return api.patch<PlannerItineraryItemDto>(
    `/main-planner/trips/${tripId}/items/${itemId}`,
    body,
  );
}

/** 일정 항목 삭제 */
export function deleteItineraryItem(tripId: string, itemId: string) {
  return api.delete<void>(`/main-planner/trips/${tripId}/items/${itemId}`);
}

/** 일정 항목 순서 변경 (드래그&드롭) */
export function reorderItineraryItems(tripId: string, body: PlannerReorderItemsRequestDto) {
  return api.patch<void>(`/main-planner/trips/${tripId}/items/reorder`, body);
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

/** 여행 진행 중 현재 위치 보고 (미도착 감지용 서버 캐시). 실패해도 조용히 무시된다. */
export function reportLiveLocation(body: UpdateLiveLocationDto) {
  return api.post<void>('/live/location', body);
}

/** 대안 팝업 자유 텍스트 요청 → 재계획 트리거 (manual, BullMQ 잡 등록) */
export function requestTripReplan(body: ReplanRequestDto) {
  return api.post<ReplanJobDto>('/alternative/request', body);
}
