'use client';

import { useState } from 'react';
import { LuChevronRight } from 'react-icons/lu';
import type { UserDto } from '@tripick/types';

import { Switch } from '@/shared/ui';

import { ROWS } from '../model/rows';
import { useNotificationPreferences } from '../model/use-notification-preferences';
import { NotificationDetailModal } from './notification-detail-modal';

type Props = {
  me: UserDto | null | undefined;
  onError?: (error: Error | null) => void;
};

/**
 * 알림 설정 섹션. 전체 스위치 한 줄 + 세부는 모달로 넘긴다 —
 * 카테고리를 전부 펼쳐 두면 설정 페이지가 그만큼 길어지고, 항목이 늘 때마다 더 길어진다.
 */
export function NotificationPreferencesList({ me, onError }: Props) {
  const prefs = useNotificationPreferences({ me, ...(onError ? { onError } : {}) });
  const [detailOpen, setDetailOpen] = useState(false);

  return (
    <>
      <div className="divide-y divide-[color:var(--line)]">
        <div className="flex items-start gap-3 px-1 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-bold text-[color:var(--ink)]">모든 알림</div>
            <p className="mt-0.5 text-[12px] leading-[18px] text-[color:var(--ink-sub)]">
              끄면 푸시를 보내지 않아요. 알림함에는 읽음 상태로 그대로 쌓여요.
            </p>
          </div>
          <Switch
            checked={prefs.anyOn}
            disabled={prefs.disabled}
            onChange={prefs.toggleAll}
            aria-label={`모든 알림 ${prefs.anyOn ? '끄기' : '켜기'}`}
          />
        </div>

        <button
          type="button"
          onClick={() => setDetailOpen(true)}
          className="flex h-12 w-full items-center justify-between rounded-[12px] px-1 text-left hover:bg-[color:var(--card-soft)]"
        >
          <span className="text-[14px] font-bold text-[color:var(--ink)]">세부 알림</span>
          <span className="flex items-center gap-1">
            <span className="text-[13px] font-semibold text-[color:var(--ink-faint)]">
              {prefs.anyOn ? `${ROWS.length}개 중 ${prefs.enabledRows}개 켜짐` : '전체 꺼짐'}
            </span>
            <LuChevronRight className="size-4 text-[color:var(--ink-faint)]" aria-hidden />
          </span>
        </button>
      </div>

      {detailOpen ? (
        <NotificationDetailModal prefs={prefs} onClose={() => setDetailOpen(false)} />
      ) : null}
    </>
  );
}
