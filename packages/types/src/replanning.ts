export type ReplanTrigger = 'deviation' | 'weather' | 'manual';
export type ReplanStatus = 'pending' | 'processing' | 'completed' | 'failed';

/** 일정 강도(하루 일정 밀도) */
export type ReplanPace = 'relaxed' | 'balanced' | 'packed';
/** 예산 수준 */
export type ReplanBudget = 'thrifty' | 'normal' | 'premium';

/** 재계획 시 반드시 포함할 실제 장소 (카카오 검색 결과) */
export interface ReplanPlaceDto {
  name: string;
  address?: string;
  /** 카카오 카테고리명 (있으면 종류 추론에 사용) */
  category?: string;
  lat: number;
  lng: number;
}

/** 재계획 구조화 옵션 */
export interface ReplanPreferencesDto {
  /** 일정 강도 → 하루 일정 개수에 반영 */
  pace?: ReplanPace;
  /** 피하고 싶은 것 (자유 텍스트) */
  avoid?: string;
  /** 이동 동선 최소화 */
  minimizeTravel?: boolean;
  /** 예산 수준 */
  budget?: ReplanBudget;
}

export interface ReplanRequestDto {
  tripId: string;
  trigger: ReplanTrigger;
  currentLocation?: {
    lat: number;
    lng: number;
  };
  /** 이탈한 일정 항목 ID */
  deviatedItemId?: string;
  /** 사용자 자유 텍스트 요청 (예: "조용한 감성 카페 위주로"). 재계획 시 검색·프롬프트에 반영 */
  note?: string;
  /** 이번 재계획에 반드시 포함할 장소들 */
  mustIncludePlaces?: ReplanPlaceDto[];
  /** 재계획 구조화 옵션 */
  preferences?: ReplanPreferencesDto;
  context?: Record<string, unknown>;
}

export interface ReplanJobDto {
  jobId: string;
  tripId: string;
  trigger: ReplanTrigger;
  status: ReplanStatus;
  createdAt: string;
}

export interface ReplanResultDto {
  jobId: string;
  tripId: string;
  status: ReplanStatus;
  updatedItems?: import('./itinerary').ItineraryItemDto[];
  explanation?: string;
  completedAt?: string;
}

/** WebSocket 이벤트 페이로드 */
export interface WsReplanResultEvent {
  event: 'replan_result';
  data: ReplanResultDto;
}
