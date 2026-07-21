'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { NotificationPreferenceKey, UserDto } from '@tripick/types';

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  updateNotificationPreferences,
} from '@/entities/user';
import { queryKeys } from '@/shared/api/query-keys';
import { Switch } from '@/shared/ui';

/**
 * key: 스위치 상태를 읽는 대표 키. alsoKeys 가 있으면 토글 시 함께 갱신한다.
 * 날씨·혼잡·미도착 추천은 성격이 같아 한 스위치(weather_alert 대표)로 세 키를 함께 켜고 끈다.
 */
const ROWS: ReadonlyArray<{
  key: NotificationPreferenceKey;
  alsoKeys?: ReadonlyArray<NotificationPreferenceKey>;
  label: string;
  description: string;
}> = [
  {
    key: 'trip_invite',
    label: '여행 초대',
    description: '친구가 여행에 초대했을 때 알려줘요.',
  },
  {
    key: 'friend_request',
    label: '친구 요청',
    description: '새로운 친구 요청이 도착했을 때 알려줘요.',
  },
  {
    key: 'replan_ready',
    label: '재계획 완료',
    description: '요청한 대안 일정 반영이 끝나면 알려줘요.',
  },
  {
    key: 'weather_alert',
    alsoKeys: ['crowd_alert', 'arrival_alert'],
    label: '날씨·혼잡·미도착 추천',
    description: '날씨·혼잡·미도착 등 상황이 바뀌면 일정을 바꿀지 추천해요.',
  },
  {
    key: 'trip_reminder',
    label: '여행 임박 리마인더',
    description: '출발 하루 전에 챙길 것을 정리해 알려줘요.',
  },
  {
    key: 'general',
    label: '일반 알림',
    description: '서비스 안내나 이벤트 소식을 알려줘요.',
  },
];

type Props = {
  me: UserDto | null | undefined;
  onError?: (error: Error | null) => void;
};

export function NotificationPreferencesList({ me, onError }: Props) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (preferences: Partial<Record<NotificationPreferenceKey, boolean>>) =>
      updateNotificationPreferences({ preferences }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.user.me });
      onError?.(null);
    },
    onError: (err) => onError?.(err instanceof Error ? err : null),
  });

  const merged = {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    ...(me?.notificationPreferences ?? {}),
  };

  return (
    <div className="divide-y divide-[#F2F4F6]">
      {ROWS.map((row) => {
        const enabled = merged[row.key];
        return (
          <div key={row.key} className="flex items-start gap-3 px-1 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-bold text-[#191F28]">{row.label}</div>
              <p className="mt-0.5 text-[12px] leading-[18px] text-[#6B7684]">
                {row.description}
              </p>
            </div>
            <Switch
              checked={enabled}
              disabled={mutation.isPending}
              onChange={(next) => {
                const patch: Partial<Record<NotificationPreferenceKey, boolean>> = {
                  [row.key]: next,
                };
                for (const also of row.alsoKeys ?? []) patch[also] = next;
                mutation.mutate(patch);
              }}
              aria-label={`${row.label} 알림 ${enabled ? '끄기' : '켜기'}`}
            />
          </div>
        );
      })}
    </div>
  );
}
