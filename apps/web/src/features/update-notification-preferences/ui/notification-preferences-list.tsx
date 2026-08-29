'use client';

import { useState } from 'react';
import { LuChevronDown } from 'react-icons/lu';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { NotificationPreferenceKey, UserDto } from '@tripick/types';

import { DEFAULT_NOTIFICATION_PREFERENCES, updateNotificationPreferences } from '@/entities/user';
import { queryKeys } from '@/shared/api/query-keys';
import { readJson, writeJson } from '@/shared/lib/storage';
import { Switch } from '@/shared/ui';

type Preferences = Partial<Record<NotificationPreferenceKey, boolean>>;

/**
 * key: 스위치 상태를 읽는 대표 키. alsoKeys 가 있으면 토글 시 함께 갱신한다.
 * 성격이 같은 카테고리는 한 줄로 묶는다 — 사용자는 "날씨 때문에 온 알림"과 "혼잡 때문에 온 알림"을
 * 따로 관리하지 않고, 일정 변경 제안도 요청(owner)·결과(참여자)가 같은 기능의 양쪽 끝이라
 * 한쪽만 남으면 오히려 이상하다.
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
    key: 'schedule_change_request',
    alsoKeys: ['schedule_change_result'],
    label: '일정 변경 요청·결과',
    description: '동행이 일정 변경을 제안하거나, 내 제안이 처리되면 알려줘요.',
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

const ALL_KEYS = Object.keys(DEFAULT_NOTIFICATION_PREFERENCES) as NotificationPreferenceKey[];

/** 전체 끄기 직전의 세부 설정. 다시 켤 때 "전부 켜기"로 뭉개지 않고 되돌리기 위한 것. */
const SNAPSHOT_KEY = 'tripick.notification-snapshot.v1';

function allOff(): Preferences {
  return Object.fromEntries(ALL_KEYS.map((key) => [key, false]));
}

function allOn(): Preferences {
  return Object.fromEntries(ALL_KEYS.map((key) => [key, true]));
}

type Props = {
  me: UserDto | null | undefined;
  onError?: (error: Error | null) => void;
};

/**
 * 알림 설정. 맨 위 "모든 알림" 한 줄로 전체를 끄고 켜며, 세부 항목은 접어 둔다 —
 * 카테고리가 늘어도 설정 페이지 길이가 그대로다.
 *
 * 마스터는 따로 저장하는 값이 아니라 세부 항목에서 파생한다(하나라도 켜져 있으면 켜짐).
 * 서버 스키마를 늘리지 않으려는 것이고, "알림이 하나도 안 온다"는 상태의 정의가
 * 마스터 플래그와 개별 값 두 곳으로 갈라지지 않는 이점도 있다.
 */
export function NotificationPreferencesList({ me, onError }: Props) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);

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

  const enabledRows = ROWS.filter((row) => merged[row.key]).length;
  const anyOn = ALL_KEYS.some((key) => merged[key]);

  function toggleAll(next: boolean) {
    if (next) {
      // 껐을 때 담아 둔 세부 설정으로 되돌린다. 스냅샷이 없으면(다른 기기·저장 실패) 전부 켜기.
      const snapshot = readJson<Preferences>(SNAPSHOT_KEY);
      mutation.mutate(snapshot && Object.values(snapshot).some(Boolean) ? snapshot : allOn());
      return;
    }
    writeJson<Preferences>(
      SNAPSHOT_KEY,
      Object.fromEntries(ALL_KEYS.map((key) => [key, merged[key]])),
    );
    mutation.mutate(allOff());
  }

  return (
    <div className="divide-y divide-[color:var(--line)]">
      <div className="flex items-start gap-3 px-1 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-bold text-[color:var(--ink)]">모든 알림</div>
          <p className="mt-0.5 text-[12px] leading-[18px] text-[color:var(--ink-sub)]">
            끄면 인박스와 푸시 모두 받지 않아요. 친구 요청은 친구 페이지에선 계속 보여요.
          </p>
        </div>
        <Switch
          checked={anyOn}
          disabled={!me || mutation.isPending}
          onChange={toggleAll}
          aria-label={`모든 알림 ${anyOn ? '끄기' : '켜기'}`}
        />
      </div>

      <div>
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          aria-controls="notification-detail-rows"
          className="flex w-full items-center justify-between rounded-[12px] px-1 py-3 text-left hover:bg-[color:var(--card-soft)]"
        >
          <span className="text-[14px] font-bold text-[color:var(--ink)]">
            세부 알림
            <span className="ml-2 text-[12px] font-semibold text-[color:var(--ink-faint)]">
              {anyOn ? `${ROWS.length}개 중 ${enabledRows}개 켜짐` : '전체 꺼짐'}
            </span>
          </span>
          <LuChevronDown
            aria-hidden
            className={`size-4 shrink-0 text-[color:var(--ink-faint)] transition-transform motion-reduce:transition-none ${
              expanded ? 'rotate-180' : ''
            }`}
          />
        </button>

        {/* 높이를 0fr↔1fr 로 여는 grid 트릭 — 내용 높이를 알 필요 없이 부드럽게 접힌다. */}
        <div
          id="notification-detail-rows"
          className={`grid transition-[grid-template-rows] duration-200 motion-reduce:transition-none ${
            expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          }`}
        >
          <div className="overflow-hidden">
            <div className="divide-y divide-[color:var(--line)] border-t border-[color:var(--line)]">
              {ROWS.map((row) => {
                const enabled = merged[row.key];
                return (
                  <div key={row.key} className="flex items-start gap-3 px-1 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-bold text-[color:var(--ink)]">
                        {row.label}
                      </div>
                      <p className="mt-0.5 text-[12px] leading-[18px] text-[color:var(--ink-sub)]">
                        {row.description}
                      </p>
                    </div>
                    <Switch
                      checked={enabled}
                      disabled={!me || mutation.isPending}
                      onChange={(next) => {
                        const patch: Preferences = { [row.key]: next };
                        for (const also of row.alsoKeys ?? []) patch[also] = next;
                        mutation.mutate(patch);
                      }}
                      aria-label={`${row.label} 알림 ${enabled ? '끄기' : '켜기'}`}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
