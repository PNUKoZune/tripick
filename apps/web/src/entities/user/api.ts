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

export function updateFcmToken(fcmToken: string) {
  return api.patch<void>('/users/me/fcm-token', { fcmToken });
}

export function uploadProfileImage(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  return api.upload<UserDto>('/users/me/profile-image', formData);
}

export function removeProfileImage() {
  return api.delete<UserDto>('/users/me/profile-image');
}
