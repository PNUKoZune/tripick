/**
 * Screen 3 (Main Planner) / Screen 4 (Alternative Popup) 전용 DTO.
 * API가 저장된 여행/멤버/일정 데이터를 planner 화면 형태로 직렬화한다.
 */

export type PlannerItemType = 'attraction' | 'restaurant' | 'cafe' | 'transport';
export type PlannerBadgeTone = 'urgent' | 'recommend' | 'local';

export interface PlannerMemberDto {
  id: string;
  initial: string;
  color: string;
  friendId?: string | null;
  nickname?: string;
  role?: 'owner' | 'companion';
  status?: 'accepted' | 'pending';
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
  /** 기상청 단기예보 실데이터가 채워졌는지 여부. false 면 예보 범위(~3일) 밖이라 "확인 전" 폴백. */
  forecasted: boolean;
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

/**
 * 서버가 KST(+09:00) 기준으로 파생한 여행 진행 상태.
 * 클라가 startDate 로 직접 day 를 계산하지 않고 이 값을 신뢰한다.
 */
export interface PlannerTripProgressDto {
  /** 'upcoming' 출발 전 · 'ongoing' 진행 중 · 'done' 종료 · 'draft' 초안 */
  status: TripSummaryStatus;
  /** 오늘이 몇 일차인지 (1-based). 출발 전이면 1, 종료 후면 마지막 일차로 클램프. */
  currentDay: number;
  /** 전체 일차 수 */
  totalDays: number;
  /** 서버 응답 시각 (ISO). 클라 시계 보정·표시용. */
  serverTime: string;
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
  progress: PlannerTripProgressDto;
}

/** 대안이 어디서 왔는지: AI 추천 · 사용자 자유 텍스트 검색 · 지도 링크 붙여넣기 */
export type PlannerAlternativeOrigin = 'recommend' | 'custom' | 'link';

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
  /** swap 시 재조회 없이 바로 반영하기 위한 실제 장소 좌표 */
  lat: number;
  lng: number;
  /** 실제 장소 주소 (있을 때) */
  address?: string;
  /** 실제 장소의 일정 카테고리 */
  category: PlannerItemType;
  origin: PlannerAlternativeOrigin;
  /** 카카오 실데이터 여부. false 면 폴백(mock) 후보 */
  realPlace: boolean;
}

export interface PlannerAlternativeResponseDto {
  itemId: string;
  itemName: string;
  waitingMinutes: number;
  radiusMeters: number;
  realtime: boolean;
  /** 사용자가 입력한 자유 텍스트 요청 (있을 때 그대로 에코) */
  query?: string;
  alternatives: PlannerAlternativeDto[];
  mapCenter: PlannerMapCenterDto;
  mapMarkers: PlannerMapMarkerDto[];
}

/** 장소 이름 → 카카오 Local 로 실제 장소 1곳 해석 (사용자 확인 후 반영) */
export interface PlannerResolvePlaceRequestDto {
  /** 사용자가 입력한 장소 이름 (지도 링크도 허용) */
  query: string;
}

export interface PlannerResolvePlaceResponseDto {
  alternative: PlannerAlternativeDto;
  mapMarker: PlannerMapMarkerDto;
}

/** swap 대상 장소. 추천/커스텀/링크 어디서 왔든 동일한 형태로 반영 */
export interface PlannerSwapPlaceDto {
  name: string;
  category?: PlannerItemType;
  address?: string;
  lat: number;
  lng: number;
  mapHref?: string;
}

export interface PlannerSwapRequestDto {
  itemId: string;
  place: PlannerSwapPlaceDto;
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
  /** planner 상세 화면 진입 가능 여부 */
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
  friendId?: string | null;
  nickname?: string;
  role?: 'owner' | 'companion';
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
