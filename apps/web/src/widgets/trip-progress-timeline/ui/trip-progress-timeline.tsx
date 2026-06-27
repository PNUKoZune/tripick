'use client';

import type { PlannerItineraryItemDto } from '@tripick/types';

import type { ProgressItem } from '@/features/track-trip-progress';

type Props = {
  items: ProgressItem[];
  onReportWaiting?: (item: PlannerItineraryItemDto) => void;
};

const DOT_STYLE: Record<ProgressItem['progress'], string> = {
  done: 'bg-[#D1D6DB] border-[#D1D6DB]',
  current: 'bg-[#3182F6] border-[#3182F6]',
  upcoming: 'bg-white border-[#D1D6DB]',
};

export function TripProgressTimeline({ items, onReportWaiting }: Props) {
  if (items.length === 0) {
    return (
      <div className="rounded-[16px] border border-[#E5E8EB] bg-[#FAFBFC] px-4 py-6 text-center text-[14px] font-semibold text-[#8B95A1]">
        오늘 예정된 일정이 없어요.
      </div>
    );
  }

  return (
    <ol className="relative space-y-1">
      {items.map(({ item, progress }, index) => {
        const isCurrent = progress === 'current';
        const isDone = progress === 'done';
        return (
          <li key={item.id} className="flex gap-3">
            {/* 타임라인 레일 */}
            <div className="flex flex-col items-center">
              <span
                className={`mt-1.5 size-3 shrink-0 rounded-full border-2 ${DOT_STYLE[progress]}`}
              />
              {index < items.length - 1 ? (
                <span className="w-0.5 flex-1 bg-[#E5E8EB]" />
              ) : null}
            </div>

            {/* 카드 */}
            <div
              className={`mb-2 flex-1 rounded-[14px] border px-4 py-3 transition ${
                isCurrent
                  ? 'border-[#3182F6] bg-[#F4F9FF] shadow-[0_4px_12px_rgba(49,130,246,0.12)]'
                  : 'border-[#E5E8EB] bg-white'
              } ${isDone ? 'opacity-60' : ''}`}
            >
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-bold text-[#4E5968]">{item.scheduledAt}</span>
                <span className="text-[11px] font-semibold text-[#8B95A1]">{item.typeLabel}</span>
                {isCurrent ? (
                  <span className="rounded-full bg-[#3182F6] px-2 py-0.5 text-[10px] font-bold text-white">
                    지금
                  </span>
                ) : null}
                {item.hasWaiting ? (
                  <span className="rounded-full bg-[#FFF4E5] px-2 py-0.5 text-[10px] font-bold text-[#FF8A00]">
                    웨이팅{item.waitingMinutes ? ` ${item.waitingMinutes}분` : ''}
                  </span>
                ) : null}
              </div>
              <div className="mt-1 text-[15px] font-bold leading-5 text-[#191F28]">{item.name}</div>
              <div className="mt-0.5 text-[12px] font-medium text-[#8B95A1]">
                {item.durationLabel}
              </div>

              {isCurrent && onReportWaiting ? (
                <button
                  type="button"
                  onClick={() => onReportWaiting(item)}
                  className="mt-3 h-9 w-full rounded-[10px] border border-[#3182F6] bg-white text-[13px] font-bold text-[#1B64DA] hover:bg-[#EAF2FF]"
                >
                  웨이팅 신고
                </button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
