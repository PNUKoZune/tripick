import type { NotificationPreferencesDto } from '@tripick/types';

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferencesDto = {
  replan_ready: true,
  weather_alert: true,
  crowd_alert: true,
  arrival_alert: true,
  trip_reminder: true,
  trip_invite: true,
  schedule_change_request: true,
  schedule_change_result: true,
  general: true,
  friend_request: true,
};
