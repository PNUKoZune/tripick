import type {
  NotificationPreferencesDto,
  UpdateNotificationPreferencesDto,
  UpdateUserDto,
  UserDto,
} from '@tripick/types';

import { api } from '@/shared/lib';

export function fetchMe() {
  return api.get<UserDto>('/users/me');
}

export function updateMe(dto: UpdateUserDto) {
  return api.patch<UserDto>('/users/me', dto);
}

export function updateNotificationPreferences(dto: UpdateNotificationPreferencesDto) {
  return api.patch<NotificationPreferencesDto>('/users/me/notification-preferences', dto);
}

export function deleteMe() {
  return api.delete<void>('/users/me');
}
