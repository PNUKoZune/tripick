'use client';

import { LuRefreshCw } from 'react-icons/lu';

import { PULL_THRESHOLD, usePullToRefresh } from '../model/use-pull-to-refresh';

/** 인디케이터가 숨어 있을 때 화면 위로 빠져 있는 높이(원 40 + 여유). */
const HIDDEN_OFFSET = 48;

/**
 * 앱 전역에 마운트되는 당겨서 새로고침 인디케이터(providers).
 * 본문은 움직이지 않고 원형 스피너만 위에서 내려온다 — 본문을 끌어내리면 고정 헤더·지도·FAB 이
 * 제각각 따라오거나 남아 어긋난다.
 */
export function PullToRefresh() {
  const { enabled, distance, refreshing, dragging } = usePullToRefresh();

  if (!enabled) return null;

  const progress = Math.min(1, distance / PULL_THRESHOLD);
  const armed = distance >= PULL_THRESHOLD;

  return (
    // wvr-scope: providers 는 화면 스코프 밖이라 직접 열어야 다크 팔레트를 받는다. 배경은 투명으로 덮는다.
    <div
      aria-hidden={!refreshing}
      className="wvr-scope pointer-events-none fixed inset-x-0 top-[calc(8px+var(--safe-top))] z-40 flex justify-center bg-transparent"
    >
      <div
        role="status"
        aria-label={refreshing ? '새로고침 중' : undefined}
        className={`flex size-10 items-center justify-center rounded-full border border-[color:var(--line,#E5E8EB)] bg-[color:var(--card,#fff)] shadow-[0_6px_16px_rgba(15,23,42,0.14)] ${
          dragging ? '' : 'transition-[transform,opacity] duration-200 ease-out'
        }`}
        style={{
          transform: `translateY(${distance - HIDDEN_OFFSET}px)`,
          opacity: distance > 0 ? Math.max(0.3, progress) : 0,
        }}
      >
        <LuRefreshCw
          className={`size-[18px] ${
            armed || refreshing
              ? 'text-[color:var(--primary,#3182F6)]'
              : 'text-[color:var(--ink-faint,#8B95A1)]'
          } ${refreshing ? 'motion-safe:animate-spin' : ''}`}
          style={refreshing ? undefined : { transform: `rotate(${progress * 270}deg)` }}
        />
      </div>
    </div>
  );
}
