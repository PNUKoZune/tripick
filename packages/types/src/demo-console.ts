import type { ItineraryItemType } from './itinerary';
import type { TripStatus } from './trip';

/**
 * 시연용 어드민 콘솔 DTO.
 *
 * 제품 기능이 아니라 **발표 시연 보조 도구**다 — 알림 내용이나 일정 결과를 미리 만들어 두지
 * 않고, "지금이 일정 시각이다 / 사용자가 장소에서 멀리 있다 / 비 예보가 있다 / 관광지가
 * 붐빈다" 는 **조건만** 주입한다. 판정·발송·재계획은 운영과 같은 스캐너·인박스·FCM 경로를
 * 그대로 탄다. 서버는 `DEMO_CONSOLE_ENABLED` 가 켜졌을 때만 이 라우트를 등록한다.
 */
export type DemoScenario = 'arrival' | 'weather' | 'crowd';

export interface DemoItemSummaryDto {
  id: string;
  name: string;
  type: ItineraryItemType;
  /** 예정 시각 KST HH:mm */
  time: string;
  /** 지금 미도착 판정 창(시작+유예 ~ 지각 상한) 안에 있는 항목인지 */
  arrivalDue: boolean;
}

export interface DemoTripSummaryDto {
  tripId: string;
  title: string;
  /** 대상 일자 YYYY-MM-DD (KST) */
  date: string;
  /** 대상 일자의 1-based 일차 */
  day: number;
  items: DemoItemSummaryDto[];
}

/** 서버가 들고 있는 사용자 최신 위치(미도착 판정에 쓰는 값) 요약. */
export interface DemoLocationSummaryDto {
  lat: number;
  lng: number;
  /** 마지막 보고 이후 경과 초 */
  ageSec: number;
  /** 판정에 쓸 수 있을 만큼 신선한지 */
  fresh: boolean;
}

/**
 * 콘솔에서 고를 수 있는 여행 1건.
 *
 * 시드 여행뿐 아니라 직접 만든 여행, 참여자(accepted)로 들어가 있는 남의 여행도 대상이다 —
 * 심사위원이 자기 계정으로 만든 여행에 발표자가 조건을 걸 수 있어야 하기 때문.
 */
export interface DemoTripOptionDto {
  tripId: string;
  title: string;
  startDate: string;
  endDate: string;
  /** 총 일차 수 */
  days: number;
  status: TripStatus;
  /** 콘솔이 시드한 시연 여행인지 */
  seeded: boolean;
  /** 내가 owner 인 여행인지 — false 면 참여자로 들어가 있는 남의 여행이다 */
  owned: boolean;
  /** 알림 스캐너가 보는 상태(확정·진행 중)인지 — 아니면 알림이 나가지 않는다 */
  scannable: boolean;
}

export interface DemoConsoleStatusDto {
  user: { id: string; email: string | null; nickname: string };
  /** 선택된(또는 자동 선택된) 대상 여행의 대상 일차 요약 */
  trip: DemoTripSummaryDto | null;
  /** 고를 수 있는 여행 목록 (최근 순) */
  trips: DemoTripOptionDto[];
  location: DemoLocationSummaryDto | null;
}

export interface DemoScenarioRequestDto {
  /** 대상 여행. 생략 시 시드 여행 → 오늘 일정이 있는 여행 순으로 자동 선택 */
  tripId?: string;
  /** 대상 일차(1-based). 생략 시 오늘 일차 */
  day?: number;
  /** arrival 전용 — 일정 장소에서 이만큼(km) 떨어진 위치를 주입한다 */
  distanceKm?: number;
}

export interface DemoScenarioResultDto {
  scenario: DemoScenario;
  tripId: string;
  /** 실제로 발송된 알림 건수. 판정에서 걸러지면 0 */
  alerted: number;
  /** 콘솔 화면에 그대로 띄우는 한 줄 설명 */
  detail: string;
}
