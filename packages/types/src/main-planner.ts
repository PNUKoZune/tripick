/**
 * Screen 3 (Main Planner) / Screen 4 (Alternative Popup) 전용 DTO.
 * v1 데모에서는 mock 데이터를 그대로 직렬화한다.
 */

export type PlannerItemType = 'attraction' | 'restaurant' | 'cafe' | 'transport';
export type PlannerBadgeTone = 'urgent' | 'recommend' | 'local';

export interface PlannerMemberDto {
  id: string;
  initial: string;
  color: string;
}

export interface PlannerMapMarkerDto {
  id: string;
  /** 연결된 itinerary item 의 id (있을 때만) */
  itemId?: string;
  label: string;
  order: number;
  /** Kakao Maps lat */
  lat: number;
  /** Kakao Maps lng */
  lng: number;
  /** SDK 미로딩 시 폴백용 normalized x (0~1) */
  x: number;
  /** SDK 미로딩 시 폴백용 normalized y (0~1) */
  y: number;
  variant: 'primary' | 'current' | 'alternative';
}

export interface PlannerMapCenterDto {
  lat: number;
  lng: number;
  level: number;
}

export interface PlannerItineraryItemDto {
  id: string;
  day: number;
  /** HH:mm */
  scheduledAt: string;
  type: PlannerItemType;
  typeLabel: string;
  name: string;
  /** "도보 20분" 같은 표시용 문구 */
  durationLabel: string;
  waitingMinutes?: number;
  hasWaiting: boolean;
}

export interface PlannerDayDto {
  day: number;
  label: string;
  dateLabel: string;
}

export interface PlannerWeatherDto {
  day: number;
  label: string;
  emoji: string;
  tempLabel: string;
}

export interface PlannerTripMetaDto {
  startDate: string;
  endDate: string;
  durationLabel: string;
  transportLabel: string;
  wakeTime: string;
  sleepTime: string;
  tasteTags: {
    food: string[];
    mood: string[];
    environment: string[];
  };
  stats: {
    totalItems: number;
    waitingCount: number;
    estimatedTravelKm: number;
  };
  weather: PlannerWeatherDto[];
}

export interface PlannerTripDto {
  id: string;
  title: string;
  members: PlannerMemberDto[];
  searchPlaceholder: string;
  mapCenter: PlannerMapCenterDto;
  mapMarkers: PlannerMapMarkerDto[];
  days: PlannerDayDto[];
  items: PlannerItineraryItemDto[];
  meta: PlannerTripMetaDto;
}

export interface PlannerAlternativeDto {
  id: string;
  categoryEmoji: string;
  /** toss-v1 토큰 안에서 표현 가능한 카테고리 톤만 사용 */
  categoryTone: 'neutral' | 'primary' | 'success';
  name: string;
  walkLabel: string;
  waitLabel: string;
  rating: number;
  mapHref: string;
  badge: string;
  badgeTone: PlannerBadgeTone;
}

export interface PlannerAlternativeResponseDto {
  itemId: string;
  itemName: string;
  waitingMinutes: number;
  radiusMeters: number;
  realtime: boolean;
  alternatives: PlannerAlternativeDto[];
  mapCenter: PlannerMapCenterDto;
  mapMarkers: PlannerMapMarkerDto[];
}

export interface PlannerSwapRequestDto {
  itemId: string;
  alternativeId: string;
}

export interface PlannerSwapResponseDto {
  tripId: string;
  swappedItemId: string;
  newItemName: string;
}

export type TripSummaryStatus = 'draft' | 'upcoming' | 'ongoing' | 'done';

export interface TripSummaryDto {
  id: string;
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  durationLabel: string;
  status: TripSummaryStatus;
  statusLabel: string;
  members: PlannerMemberDto[];
  coverEmoji: string;
  highlight: string;
  itemCount: number;
  /** 진행 가능한 데모 trip 만 true (현재는 경주 1박 2일 만 mock 상세를 갖는다) */
  hasDetail: boolean;
}

/** 플래너 헤더 시트 — 친구를 trip 멤버로 추가 */
export interface AddTripMemberRequestDto {
  friendId: string;
}

/** Trip 별 취향 조율 결과 (planner 탭 전용 경량 DTO) */
export interface PlannerCoordinationMemberDto {
  id: string;
  initial: string;
  color: string;
  /** 사람별 취향 태그 라벨 (예: "한식·전통", "감성 코스") */
  tasteLabels: string[];
}

export interface PlannerCoordinationVoteRowDto {
  key: string;
  label: string;
  count: number;
  /** 표를 던진 멤버 이니셜 */
  voters: string[];
}

export interface PlannerCoordinationRecommendationDto {
  title: string;
  summary: string;
  reasons: string[];
  scheduleHint: string;
}

export interface PlannerCoordinationDto {
  tripId: string;
  members: PlannerCoordinationMemberDto[];
  consensus: {
    food: PlannerCoordinationVoteRowDto[];
    mood: PlannerCoordinationVoteRowDto[];
    environment: PlannerCoordinationVoteRowDto[];
  };
  recommendation: PlannerCoordinationRecommendationDto;
}

/** 여행 생성 폼에서 사용되는 자동완성 후보 */
export interface DestinationSuggestionDto {
  id: string;
  /** 표시 이름 (예: "해운대") */
  name: string;
  /** 상위 행정 구역 (예: "부산광역시") */
  region: string;
  emoji: string;
}

export interface CreateTripRequestDto {
  title: string;
  destination: string;
  /** ISO date (YYYY-MM-DD) */
  startDate: string;
  /** "HH:mm" 출발 시각 */
  startTime: string;
  /** ISO date (YYYY-MM-DD) */
  endDate: string;
  /** "HH:mm" 도착 시각 */
  endTime: string;
  members: PlannerMemberDto[];
  /** 이번 여행에 추가로 반영하고 싶은 요청/제약 (예: "유아 동반", "해산물 알레르기") */
  notes?: string;
}
