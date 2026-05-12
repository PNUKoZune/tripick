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
