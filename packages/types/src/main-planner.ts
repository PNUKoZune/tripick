/**
 * Screen 3 (Main Planner) / Screen 4 (Alternative Popup) 전용 DTO.
 * API가 저장된 여행/멤버/일정 데이터를 planner 화면 형태로 직렬화한다.
 */

import type { ReplanBudget, ReplanPace, ReplanPlaceDto } from './replanning';

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
  /** 체류 시간(분) — 편집 폼 prefill 용 */
  durationMin: number;
  /** 사용자 메모 — 편집 폼 prefill 용 */
  memo?: string;
  /** 카카오 장소 ID — 있으면 카카오맵 장소 페이지 링크에 사용 */
  kakaoPlaceId?: string;
}

/** 일정 항목 신규 추가 요청 */
export interface PlannerAddItemRequestDto {
  day: number;
  name: string;
  /** HH:mm */
  scheduledAt: string;
  type?: PlannerItemType;
  durationMin?: number;
  address?: string;
  lat?: number;
  lng?: number;
  memo?: string;
  /** 카카오 장소 ID (있으면 항목에 저장) */
  kakaoPlaceId?: string;
}

/** 일정 항목 부분 수정 요청 (시간·메모·이름·체류시간) */
export interface PlannerUpdateItemRequestDto {
  name?: string;
  /** HH:mm */
  scheduledAt?: string;
  durationMin?: number;
  memo?: string;
}

/** 일정 항목 순서 변경 요청 (해당 일차의 새 순서) */
export interface PlannerReorderItemsRequestDto {
  day: number;
  orderedItemIds: string[];
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
  /** 그 날의 최대 강수확률(%). 단기예보에만 POP 가 있어 중기(+3~+10일)·폴백 일자는 undefined. */
  precipitationProbability?: number;
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
    estimatedTravelKm: number;
  };
  weather: PlannerWeatherDto[];
}

/**
 * 서버가 KST(+09:00) 기준으로 파생한 여행 진행 상태.
 * 클라가 startDate 로 직접 day 를 계산하지 않고 이 값을 신뢰한다.
 */
export interface PlannerTripProgressDto {
  /** 'upcoming' 출발 전 · 'ongoing' 진행 중 · 'done' 종료 · 'draft' 준비 중(일정 미생성) */
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
  /** 조회한 사용자가 이 여행의 소유자인지 (삭제 등 owner 전용 기능 노출용) */
  isOwner: boolean;
  members: PlannerMemberDto[];
  searchPlaceholder: string;
  mapCenter: PlannerMapCenterDto;
  mapMarkers: PlannerMapMarkerDto[];
  days: PlannerDayDto[];
  items: PlannerItineraryItemDto[];
  meta: PlannerTripMetaDto;
  progress: PlannerTripProgressDto;
}

/** 공유 링크 활성화 응답 */
export interface TripShareResponseDto {
  /** 공유 토큰. 공유 URL 은 프론트가 `${origin}/share/${token}` 로 구성한다 */
  token: string;
}

/** 공개 공유 페이지에서 렌더할 읽기 전용 일정 (인증 불필요) */
export interface SharedItineraryDto {
  title: string;
  destination: string;
  durationLabel: string;
  transportLabel: string;
  memberCount: number;
  startDate: string;
  endDate: string;
  days: PlannerDayDto[];
  items: PlannerItineraryItemDto[];
  mapCenter: PlannerMapCenterDto;
  mapMarkers: PlannerMapMarkerDto[];
}

/** 대안이 어디서 왔는지: AI 추천(CRAG) · 장소 이름 검색으로 직접 지정 */
export type PlannerAlternativeOrigin = 'recommend' | 'link';

export interface PlannerAlternativeDto {
  id: string;
  categoryEmoji: string;
  /** toss-v1 토큰 안에서 표현 가능한 카테고리 톤만 사용 */
  categoryTone: 'neutral' | 'primary' | 'success';
  name: string;
  walkLabel: string;
  waitLabel: string;
  /** 취향 근거(CRAG reason). 왜 이 후보가 추천됐는지 카드에 한 줄로 노출 */
  reason?: string;
  /** 알려진 영업시간(HH:MM-HH:MM). 없으면 미제공 */
  openingHours?: string;
  /** 영업시간을 알고, 이 일정 항목의 방문 시각이 그 밖일 때만 true (swap 전 경고용) */
  closedAtScheduled?: boolean;
  /** 실제 평점이 있을 때만 (카카오는 미제공이라 대부분 없음) */
  rating?: number;
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
  /** 카카오 장소 ID (실데이터일 때). swap 시 항목에 저장돼 상세 링크에 사용 */
  kakaoPlaceId?: string;
  origin: PlannerAlternativeOrigin;
  /** 카카오 실데이터 여부. false 면 폴백(mock) 후보 */
  realPlace: boolean;
}

export interface PlannerAlternativeResponseDto {
  itemId: string;
  itemName: string;
  /** 실데이터(카카오/pgvector) 기반 후보가 하나라도 포함됐는지 */
  realtime: boolean;
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
  /** 검색된 실제 장소 후보들 (상위 몇 곳). 사용자가 이 중 맞는 곳을 고른다 */
  alternatives: PlannerAlternativeDto[];
  mapMarkers: PlannerMapMarkerDto[];
}

/** swap 대상 장소. 추천/커스텀/링크 어디서 왔든 동일한 형태로 반영 */
export interface PlannerSwapPlaceDto {
  name: string;
  category?: PlannerItemType;
  address?: string;
  lat: number;
  lng: number;
  mapHref?: string;
  /** 카카오 장소 ID (있으면 항목에 저장) */
  kakaoPlaceId?: string;
}

export interface PlannerSwapRequestDto {
  itemId: string;
  place: PlannerSwapPlaceDto;
}

export interface PlannerSwapResponseDto {
  tripId: string;
  swappedItemId: string;
  newItemName: string;
  /** 반영 후 실현가능성 경고 (이동시간이 빠듯한 경우 등). 없으면 생략 */
  warnings?: string[];
  /** 되돌리기용: 바뀌기 직전 장소 (이 값으로 다시 swap 하면 원복) */
  previousPlace: PlannerSwapPlaceDto;
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
}

export interface CreateTripRequestDto {
  title: string;
  /** 대표 지역(지도 중심·표지 등 표시용). 일자별 지역을 쓰더라도 요약 라벨로 항상 채운다 */
  destination: string;
  /**
   * 일자별 지역 목록. 인덱스 i = (i+1)일차, 각 원소는 그 날의 지역 배열(하루 여러 지역 허용).
   * 생략하면 모든 날을 `destination` 하나로 채운다('모든 날 같은 지역'). 있으면 길이는 여행 일수와 같아야 한다.
   */
  dayRegions?: string[][];
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
  /** 일정에 반드시 포함할 장소 (카카오 검색 결과) */
  mustIncludePlaces?: ReplanPlaceDto[];
  /** 일정 강도(하루 일정 밀도) */
  pace?: ReplanPace;
  /** 예산 수준 */
  budget?: ReplanBudget;
  /** 선호 이동 수단: transit(대중교통) | car(자가용) */
  transportMode?: 'transit' | 'car';
}
