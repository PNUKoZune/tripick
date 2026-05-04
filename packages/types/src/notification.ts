export type NotificationType = 'replan_ready' | 'weather_alert' | 'trip_reminder' | 'general';

export interface PushNotificationDto {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;
}
