'use client';

import { useEffect, useRef } from 'react';
import type { PlannerItineraryItemDto } from '@tripick/types';

import type { ProgressItem } from '@/features/track-trip-progress';

type Props = {
  items: ProgressItem[];
  selectedItemId?: string | null;
  onSelectItem?: (item: PlannerItineraryItemDto) => void;
  /** 현재 일정에서 대안 팝업(일정 변경)을 연다 */
  onSwitchItem?: (item: PlannerItineraryItemDto) => void;
};

const DOT_STYLE: Record<ProgressItem['progress'], string> = {
  done: 'bg-[color:var(--line-dot)] border-[color:var(--line-dot)]',
  current: 'bg-[color:var(--primary)] border-[color:var(--primary)]',
  upcoming: 'bg-[color:var(--card)] border-[color:var(--line-dot)]',
};

export function TripProgressTimeline({ items, selectedItemId, onSelectItem, onSwitchItem }: Props) {
  const currentRef = useRef<HTMLLIElement>(null);
  const currentId = items.find((entry) => entry.progress === 'current')?.item.id ?? null;

  // current 항목이 정해지면 스크롤 컨테이너에서 가운데로 이동 (로드 시 + current 변경 시)
  useEffect(() => {
    if (currentId) {
      currentRef.current?.scrollIntoView({ block: 'center' });
    }
  }, [currentId]);

  if (items.length === 0) {
    return (
      <div className="rounded-[16px] border border-[color:var(--line)] bg-[color:var(--card-soft)] px-4 py-6 text-center text-[14px] font-semibold text-[color:var(--ink-faint)]">
        오늘 예정된 일정이 없어요.
      </div>
    );
  }

  return (
    <ol className="relative">
      {items.map(({ item, progress }, index) => {
        const isCurrent = progress === 'current';
        const isDone = progress === 'done';
        const isLast = index === items.length - 1;
        const isFirst = index === 0;
        const isSelected = selectedItemId === item.id;
        return (
          <li
            key={item.id}
            ref={isCurrent ? currentRef : undefined}
            className="relative flex gap-3 pb-3 last:pb-0"
          >
            {/* 타임라인 레일: dot 을 카드 세로 중앙에 두고 선이 위아래로 관통 */}
            <div className="relative flex w-3 shrink-0 items-center justify-center">
              {!isFirst ? (
                <span className="absolute left-1/2 top-0 h-1/2 w-0.5 -translate-x-1/2 bg-[color:var(--line)]" />
              ) : null}
              {!isLast ? (
                <span className="absolute left-1/2 top-1/2 -bottom-3 w-0.5 -translate-x-1/2 bg-[color:var(--line)]" />
              ) : null}
              <span
                className={`relative z-10 size-3 shrink-0 rounded-full border-2 ${DOT_STYLE[progress]} ${
                  isCurrent ? 'ring-4 ring-[color:var(--primary)]/15' : ''
                }`}
              />
            </div>

            {/* 카드 */}
            <div
              onClick={() => onSelectItem?.(item)}
              role={onSelectItem ? 'button' : undefined}
              className={`flex-1 rounded-[14px] border px-4 py-3 transition ${
                onSelectItem
                  ? 'cursor-pointer hover:border-[color:var(--primary)]/40 hover:shadow-[var(--shadow-card)]'
                  : ''
              } ${
                isCurrent
                  ? 'border-[color:var(--primary)] bg-[color:var(--primary-tint)] shadow-[var(--shadow-card)]'
                  : 'border-[color:var(--line)] bg-[color:var(--card)]'
              } ${
                isSelected
                  ? 'ring-2 ring-[color:var(--primary)] ring-offset-1 ring-offset-[color:var(--card)]'
                  : ''
              } ${isDone ? 'opacity-60' : ''}`}
            >
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-bold text-[color:var(--ink-sub)]">
                  {item.scheduledAt}
                </span>
                <span className="text-[11px] font-semibold text-[color:var(--ink-faint)]">
                  {item.typeLabel}
                </span>
                {isCurrent ? (
                  <span className="rounded-full bg-[color:var(--btn-bg)] px-2 py-0.5 text-[10px] font-bold text-[color:var(--btn-text)]">
                    지금
                  </span>
                ) : null}
              </div>
              <div className="mt-1 text-[15px] font-bold leading-5 text-[color:var(--ink)]">
                {item.name}
              </div>
              <div className="mt-0.5 text-[12px] font-medium text-[color:var(--ink-faint)]">
                {item.durationLabel}
              </div>

              {isCurrent && onSwitchItem ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSwitchItem(item);
                  }}
                  className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-[10px] border border-[color:var(--primary)] bg-[color:var(--card)] text-[13px] font-bold text-[color:var(--primary-deep)] hover:bg-[color:var(--primary-tint)]"
                >
                  <SwapIcon />
                  일정 변경
                </button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function SwapIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 8h13l-3-3M20 16H7l3 3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
