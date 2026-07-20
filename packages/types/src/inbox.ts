/**
 * 인박스(/inbox) 페이지 전용 DTO.
 *
 * InboxItem 은 두 가지 출처를 통합한다:
 * - DB 영속 `NotificationEntity` (재계획, 일정 알림, 일반 공지 등)
 * - 가상 row: 친구 incoming 요청 (정본은 friends 테이블, 인박스에선 가상 인박스 row 로 직렬화)
 */

export type NotificationCategory =
  | 'replan_ready'
  | 'weather_alert'
  | 'crowd_alert'
  | 'trip_reminder'
  | 'trip_invite'
  | 'general';

export type InboxItemKind = NotificationCategory | 'friend_request';

export interface InboxItemActionDto {
  /** UI 에서 어떤 동작을 그릴지 결정 */
  type:
    | 'open-trip' // tripId 가지고 /planner 이동
    | 'open-friends' // /friends 이동
    | 'accept-friend' // friend.id 로 PATCH /friends/:id/accept
    | 'reject-friend' // friend.id 로 DELETE /friends/:id
    | 'accept-trip-invite' // tripId + tripMemberId 로 invite 수락
    | 'reject-trip-invite'; // tripId + tripMemberId 로 invite 거절
  label: string;
  /** 액션 동작에 필요한 식별자 */
  tripId?: string;
  tripMemberId?: string;
  friendId?: string;
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

export interface CreateNotificationDto {
  userId: string;
  category: NotificationCategory;
  title: string;
  body: string;
  payload?: Record<string, string>;
}
