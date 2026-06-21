import type { TasteTagDto } from './preference';

export type TripMemberStatus = 'accepted' | 'pending';
export type TripMemberRole = 'owner' | 'companion';
export type TripBudgetLevel = 'low' | 'medium' | 'high';

export interface TripMemberPreferenceDto {
  food: string[];
  mood: string[];
  environment: string[];
  transportMode: 'walk' | 'transit' | 'car';
  budgetLevel: TripBudgetLevel;
}

export interface TripMemberDto {
  id: string;
  tripId: string;
  userId?: string | null;
  friendId?: string | null;
  nickname: string;
  contact?: string | null;
  kakaoId?: string | null;
  relation?: string | null;
  role: TripMemberRole;
  status: TripMemberStatus;
  color: string;
  preferenceTags: TripMemberPreferenceDto;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTripMemberDto {
  nickname: string;
  contact?: string;
  kakaoId?: string;
  relation?: string;
  status?: TripMemberStatus;
  preferenceTags?: Partial<TripMemberPreferenceDto>;
}

export interface UpdateTripMemberDto {
  nickname?: string;
  contact?: string | null;
  kakaoId?: string | null;
  relation?: string | null;
  status?: TripMemberStatus;
  preferenceTags?: Partial<TripMemberPreferenceDto>;
}

export interface PreferenceVoteDto {
  key: string;
  label: string;
  count: number;
  memberNames: string[];
}

export interface PreferenceCoordinationDto {
  tripId: string;
  members: TripMemberDto[];
  consensus: {
    food: PreferenceVoteDto[];
    mood: PreferenceVoteDto[];
    environment: PreferenceVoteDto[];
    transportMode: PreferenceVoteDto[];
    budgetLevel: PreferenceVoteDto[];
  };
  recommendation: {
    title: string;
    summary: string;
    reasons: string[];
    scheduleHint: string;
  };
  ownerTasteTags?: TasteTagDto;
  updatedAt: string;
}
