'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@tripick/types';
import type { NotificationPreferenceKey, UserDto } from '@tripick/types';

import { updateNotificationPreferences } from '@/entities/user';
import { queryKeys } from '@/shared/api/query-keys';
import { readJson, writeJson } from '@/shared/lib/storage';

import { ALL_KEYS, ROWS, type Preferences } from './rows';

/** 전체 끄기 직전의 세부 설정. 다시 켤 때 "전부 켜기"로 뭉개지 않고 되돌리기 위한 것. */
const SNAPSHOT_KEY = 'tripick.notification-snapshot.v1';

type Params = {
  me: UserDto | null | undefined;
  onError?: (error: Error | null) => void;
};

/**
 * 알림 설정 읽기·쓰기. 설정 섹션(마스터)과 세부 모달이 같은 mutation 을 공유한다.
 *
 * 마스터는 따로 저장하는 값이 아니라 세부 항목에서 파생한다(하나라도 켜져 있으면 켜짐).
 * 서버 스키마를 늘리지 않으려는 것이고, "알림이 하나도 안 온다"는 상태의 정의가
 * 마스터 플래그와 개별 값 두 곳으로 갈라지지 않는 이점도 있다.
 */
export function useNotificationPreferences({ me, onError }: Params) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (preferences: Preferences) => updateNotificationPreferences({ preferences }),
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

  return {
    merged,
    anyOn: ALL_KEYS.some((key) => merged[key]),
    enabledRows: ROWS.filter((row) => merged[row.key]).length,
    pending: mutation.isPending,
    disabled: !me || mutation.isPending,

    toggleRow(
      key: NotificationPreferenceKey,
      alsoKeys: ReadonlyArray<NotificationPreferenceKey> | undefined,
      next: boolean,
    ) {
      const patch: Preferences = { [key]: next };
      for (const also of alsoKeys ?? []) patch[also] = next;
      mutation.mutate(patch);
    },

    toggleAll(next: boolean) {
      if (next) {
        // 껐을 때 담아 둔 세부 설정으로 되돌린다. 스냅샷이 없으면(다른 기기·저장 실패) 전부 켜기.
        const snapshot = readJson<Preferences>(SNAPSHOT_KEY);
        const restore = snapshot && Object.values(snapshot).some(Boolean) ? snapshot : null;
        mutation.mutate(restore ?? Object.fromEntries(ALL_KEYS.map((key) => [key, true])));
        return;
      }
      writeJson<Preferences>(
        SNAPSHOT_KEY,
        Object.fromEntries(ALL_KEYS.map((key) => [key, merged[key]])),
      );
      mutation.mutate(Object.fromEntries(ALL_KEYS.map((key) => [key, false])));
    },
  };
}
