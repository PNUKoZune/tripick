/**
 * 인박스(/inbox) 페이지 전용 DTO.
 *
 * InboxItem 은 두 가지 출처를 통합한다:
 * - DB 영속 `NotificationEntity` (재계획, 일정 알림, 일반 공지 등)
 * - 가상 row: 친구 incoming 요청 (정본은 friends 테이블, 인박스에선 가상 인박스 row 로 직렬화)
 */

import type { ReplanTrigger } from './replanning';

export type NotificationCategory =
  | 'replan_ready'
  | 'weather_alert'
  | 'crowd_alert'
  | 'arrival_alert'
  | 'trip_reminder'
  | 'trip_invite'
  | 'schedule_change_request' // owner: 참여자가 낸 일정 변경 제안(승인/거절)
  | 'schedule_change_result' // 참여자: 내 제안에 대한 owner 승인/거절 결과
  | 'general';

export type InboxItemKind = NotificationCategory | 'friend_request';

/**
 * 알림 카테고리 → 재계획 트리거. 여기 실린 카테고리는 "일정을 바꿀까요?" 제안 알림이라,
 * 열 때 planner 가 그 맥락을 프리필한 배너를 띄운다(자동 재계획은 안 함). 없는 카테고리는
 * 단순 일정 보기 — 특히 replan_ready 는 재계획 "결과" 알림이라 여기 넣으면 안 된다.
 *
 * 인박스 액션 빌더(InboxService)와 푸시 탭 라우팅(routeForNotification)이 함께 참조한다.
 * 한쪽만 알고 있으면 푸시를 직접 탭한 사용자에겐 배너가 아예 안 뜬다.
 * 서비스 워커(firebase-messaging-sw.js)는 앱 코드를 import 할 수 없어 같은 표가 복제돼 있다.
 */
export const REPLAN_TRIGGER_BY_CATEGORY: Partial<Record<NotificationCategory, ReplanTrigger>> = {
  weather_alert: 'weather',
  crowd_alert: 'crowd',
  arrival_alert: 'deviation',
};

export interface InboxItemActionDto {
  /** UI 에서 어떤 동작을 그릴지 결정 */
  type:
    | 'open-trip' // tripId 가지고 /planner 이동
    | 'open-friends' // /friends 이동
    | 'accept-friend' // friend.id 로 PATCH /friends/:id/accept
    | 'reject-friend' // friend.id 로 DELETE /friends/:id
    | 'accept-trip-invite' // tripId + tripMemberId 로 invite 수락
    | 'reject-trip-invite' // tripId + tripMemberId 로 invite 거절
    | 'review-schedule-change' // owner: proposalId 로 planner 이동해 diff 확인 후 승인/거절
    | 'reject-schedule-change'; // owner: proposalId 로 제안 즉시 거절
  label: string;
  /** 액션 동작에 필요한 식별자 */
  tripId?: string;
  tripMemberId?: string;
  friendId?: string;
  /** 일정 변경 제안 id (schedule_change_request 액션) */
  proposalId?: string;
  /** open-trip 딥링크 시 열 일차(1-based). 없으면 여행 첫 일차로 연다 */
  day?: number;
  /**
   * open-trip 딥링크가 재계획을 권하는 경우, 그 맥락 트리거(weather·crowd·deviation).
   * planner 에서 자동 재계획을 걸지 않고, 이 트리거를 프리필한 비침습 배너로만 제안한다.
   * 없으면 단순 일정 보기.
   */
  replan?: ReplanTrigger;
}

export interface InboxItemDto {
  /** notification id 또는 `friend-<id>` 같은 가상 키 */
  id: string;
  kind: InboxItemKind;
  title: string;
  body: string;
  /** ISO datetime, 정렬 기준 */
  createdAt: string;
  /** 읽은 시각. 친구 요청은 항상 null 처리 (action 완료 시 사라짐) */
  readAt: string | null;
  /** UI 액션 버튼 (최대 2개 권장) */
  actions: InboxItemActionDto[];
  /** 추가 payload (deep link 등). UI 가 직접 사용하지는 않지만 디버깅용 */
  payload?: Record<string, string>;
}

export interface InboxSummaryDto {
  items: InboxItemDto[];
  unreadCount: number;
}

/**
 * WS 실시간 토스트 payload — 앱이 열려 있는(소켓 연결) 클라이언트에 즉시 뜨는 heads-up.
 * 인박스 목록 갱신(`inbox_invalidate`)과 독립: 목록은 항상 갱신하되, 토스트는 능동 알림이라
 * 필요한 경우에만 별도로 emit 한다(예: 친구 요청).
 */
export interface InboxToastDto {
  tone: 'neutral' | 'primary' | 'success' | 'warning' | 'error';
  title: string;
  message?: string;
  /** 탭 시 이동할 앱 내 경로 (없으면 닫기만) */
  href?: string;
}

export interface CreateNotificationDto {
  userId: string;
  category: NotificationCategory;
  title: string;
  body: string;
  payload?: Record<string, string>;
}
