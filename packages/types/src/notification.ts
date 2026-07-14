import type { NotificationPreferenceKey } from './user';

/**
 * 푸시 payload 의 `type` 필드 — 인박스 카테고리 5종 + friend_request.
 * friend_request 는 인박스에 영속되지 않고(가상 row) 푸시만 발송되므로
 * NotificationCategory 가 아닌 NotificationPreferenceKey 를 기준으로 삼는다.
 */
export type NotificationType = NotificationPreferenceKey;

export interface PushNotificationDto {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;
}
