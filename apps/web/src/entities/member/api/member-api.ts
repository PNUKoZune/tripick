import type {
  CreateTripMemberDto,
  PreferenceCoordinationDto,
  TripMemberDto,
  UpdateTripMemberDto,
} from '@tripick/types';
import { api } from '@/shared/api/client';

export function getTripMembers(token: string, tripId: string) {
  return api.get<TripMemberDto[]>(`/trips/${tripId}/members`, token);
}

export function createTripMember(token: string, tripId: string, dto: CreateTripMemberDto) {
  return api.post<TripMemberDto>(`/trips/${tripId}/members`, dto, token);
}

export function updateTripMember(
  token: string,
  tripId: string,
  memberId: string,
  dto: UpdateTripMemberDto,
) {
  return api.patch<TripMemberDto>(`/trips/${tripId}/members/${memberId}`, dto, token);
}

export function deleteTripMember(token: string, tripId: string, memberId: string) {
  return api.delete<null>(`/trips/${tripId}/members/${memberId}`, token);
}

export function getPreferenceCoordination(token: string, tripId: string) {
  return api.get<PreferenceCoordinationDto>(`/trips/${tripId}/preference-coordination`, token);
}
