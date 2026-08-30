'use client';

import { LuX } from 'react-icons/lu';

import { ModalShell, Switch } from '@/shared/ui';

import { ROWS } from '../model/rows';
import type { useNotificationPreferences } from '../model/use-notification-preferences';

type Props = {
  prefs: ReturnType<typeof useNotificationPreferences>;
  onClose: () => void;
};

/** 카테고리별 알림 스위치. 모바일은 하단 시트, 데스크탑은 중앙 모달. */
export function NotificationDetailModal({ prefs, onClose }: Props) {
  const { merged, disabled, toggleRow } = prefs;

  return (
    <ModalShell
      label="세부 알림"
      align="bottom"
      themed
      onDismiss={onClose}
      panelClassName="w-full max-w-[420px] overflow-hidden rounded-t-[20px] bg-[color:var(--card)] pb-[max(12px,var(--safe-bottom))] shadow-[0_24px_60px_rgba(15,23,42,0.22)] sm:rounded-[20px] sm:pb-3"
    >
      <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-5">
        <div className="min-w-0">
          <h2 className="text-[16px] font-bold text-[color:var(--ink)]">세부 알림</h2>
          <p className="mt-1 text-[12px] text-[color:var(--ink-faint)]">
            카테고리별로 인박스·푸시 수신을 정해요.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className="-mr-1 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-full text-[color:var(--ink-faint)] hover:bg-[color:var(--card-soft)]"
        >
          <LuX className="size-4" aria-hidden />
        </button>
      </div>

      {/* 항목이 늘어도 시트가 화면을 넘지 않게 목록만 스크롤한다. */}
      <div className="max-h-[58vh] overflow-y-auto border-t border-[color:var(--line)] px-5">
        <div className="divide-y divide-[color:var(--line)]">
          {ROWS.map((row) => {
            const enabled = merged[row.key];
            return (
              <div key={row.key} className="flex items-start gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-bold text-[color:var(--ink)]">{row.label}</div>
                  <p className="mt-0.5 text-[12px] leading-[18px] text-[color:var(--ink-sub)]">
                    {row.description}
                  </p>
                </div>
                <Switch
                  checked={enabled}
                  disabled={disabled}
                  onChange={(next) => toggleRow(row.key, row.alsoKeys, next)}
                  aria-label={`${row.label} 알림 ${enabled ? '끄기' : '켜기'}`}
                />
              </div>
            );
          })}
        </div>
      </div>
    </ModalShell>
  );
}
