import type { NotificationCategory } from './inbox';

export type NotificationType = NotificationCategory;

export interface PushNotificationDto {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;
}
