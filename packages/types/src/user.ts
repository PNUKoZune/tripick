import type { NotificationCategory } from './inbox';

/** 인박스 카테고리별 푸시/인박스 수신 여부 + 친구 요청 토글 */
export type NotificationPreferenceKey = NotificationCategory | 'friend_request';

export type NotificationPreferencesDto = Record<NotificationPreferenceKey, boolean>;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferencesDto = {
  replan_ready: true,
  weather_alert: true,
  trip_reminder: true,
  trip_invite: true,
  general: true,
  friend_request: true,
};

export interface UserDto {
  id: string;
  kakaoId: string;
  nickname: string;
  profileImageUrl?: string;
  email?: string;
  isDemo?: boolean;
  notificationPreferences?: NotificationPreferencesDto;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateUserDto {
  nickname?: string;
  profileImageUrl?: string;
}

export interface UpdateNotificationPreferencesDto {
  /** 일부만 보내 부분 갱신 가능 */
  preferences: Partial<NotificationPreferencesDto>;
}
