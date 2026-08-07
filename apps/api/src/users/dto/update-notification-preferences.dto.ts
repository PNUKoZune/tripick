import {
  ValidateBy,
  buildMessage,
  type ValidationOptions,
} from 'class-validator';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferencesDto,
  type UpdateNotificationPreferencesDto as UpdateShape,
} from '@tripick/types';

/** 정본 키 목록. 기본값 객체에서 뽑아 새 카테고리가 생겨도 따로 관리할 게 없다. */
export const NOTIFICATION_PREFERENCE_KEYS = Object.keys(
  DEFAULT_NOTIFICATION_PREFERENCES,
) as (keyof NotificationPreferencesDto)[];

/**
 * 알려진 알림 카테고리 키 + boolean 값만 통과시킨다.
 *
 * 예전에는 이 본문이 그대로 jsonb 컬럼에 spread 돼서, 아무 키·아무 값이나 사용자 행에
 * 영구 저장할 수 있었다(공유 타입이 인터페이스라 ValidationPipe 도 안 걸렸다).
 */
function IsNotificationPreferences(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isNotificationPreferences',
      validator: {
        validate: (value: unknown) => {
          if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
          return Object.entries(value).every(
            ([key, entry]) =>
              (NOTIFICATION_PREFERENCE_KEYS as string[]).includes(key) &&
              typeof entry === 'boolean',
          );
        },
        defaultMessage: buildMessage(
          (prefix) =>
            `${prefix}알림 설정은 ${NOTIFICATION_PREFERENCE_KEYS.join(', ')} 키에 true/false 만 넣을 수 있어요.`,
          options,
        ),
      },
    },
    options,
  );
}

export class UpdateNotificationPreferencesBodyDto implements UpdateShape {
  @IsNotificationPreferences()
  preferences: Partial<NotificationPreferencesDto>;
}
