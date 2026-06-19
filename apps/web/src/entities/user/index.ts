export { fetchMe, updateMe, updateNotificationPreferences, deleteMe } from './api';
export type {
  UserDto as MeUser,
  UpdateUserDto as UpdateMeInput,
  NotificationPreferencesDto,
  NotificationPreferenceKey,
  UpdateNotificationPreferencesDto,
} from '@tripick/types';
export { DEFAULT_NOTIFICATION_PREFERENCES } from '@tripick/types';
