import { forwardRef } from 'react';
import type { PlannerDayDto, PlannerItineraryItemDto } from '@tripick/types';

import { ItemTypeIcon } from '@/shared/ui';

type Props = {
  title: string;
  subtitle: string;
  days: PlannerDayDto[];
  items: PlannerItineraryItemDto[];
};

/**
 * 이미지·PDF 로 내보내기 위한 정적 일정 카드. 지도 대신 텍스트 기반 요약이라
 * html-to-image 로 안정적으로 캡처된다. 화면 밖(offscreen)에서 렌더해 사용한다.
 */
export const ShareableItinerary = forwardRef<HTMLDivElement, Props>(function ShareableItinerary(
  { title, subtitle, days, items },
  ref,
) {
  return (
    <div
      ref={ref}
      style={{ width: 720, fontFamily: 'system-ui, -apple-system, sans-serif' }}
      className="bg-white p-8 text-[#191F28]"
    >
      <div className="flex items-start justify-between border-b border-[#E5E8EB] pb-4">
        <div>
          <div className="text-[12px] font-bold tracking-wide text-[#3182F6]">
            TRIPICK · 여행 일정
          </div>
          <h1 className="mt-1 text-[26px] font-bold leading-[34px]">{title}</h1>
          <div className="mt-1 text-[14px] text-[#6B7684]">{subtitle}</div>
        </div>
        <div className="rounded-[12px] bg-[#EAF2FF] px-3 py-2 text-center">
          <div className="text-[11px] font-semibold text-[#6B7684]">총 일정</div>
          <div className="text-[20px] font-bold text-[#1B64DA]">{items.length}</div>
        </div>
      </div>

      <div className="mt-5 space-y-6">
        {days.map((day) => {
          const dayItems = items
            .filter((item) => item.day === day.day)
            .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
          return (
            <div key={day.day}>
              <div className="mb-2 flex items-baseline gap-2">
                <span className="rounded-full bg-[#191F28] px-2.5 py-1 text-[12px] font-bold text-white">
                  {day.label}
                </span>
                <span className="text-[13px] font-semibold text-[#8B95A1]">{day.dateLabel}</span>
              </div>
              {dayItems.length === 0 ? (
                <div className="rounded-[12px] bg-[#F7F8FA] px-4 py-3 text-[13px] text-[#8B95A1]">
                  등록된 일정이 없어요.
                </div>
              ) : (
                <div className="space-y-2">
                  {dayItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-start gap-3 rounded-[12px] border border-[#E5E8EB] px-4 py-3"
                    >
                      <div className="w-[46px] shrink-0 pt-0.5 text-[13px] font-bold text-[#191F28]">
                        {item.scheduledAt}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <ItemTypeIcon
                            type={item.type}
                            className="size-4 shrink-0 text-[#6B7684]"
                          />
                          <span className="text-[16px] font-semibold">{item.name}</span>
                        </div>
                        <div className="mt-0.5 text-[12px] text-[#6B7684]">
                          {item.typeLabel} · {item.durationLabel}
                        </div>
                        {item.memo ? (
                          <div className="mt-1 rounded-[8px] bg-[#F7F8FA] px-2 py-1 text-[12px] text-[#6B7684]">
                            {item.memo}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-6 border-t border-[#E5E8EB] pt-3 text-center text-[11px] text-[#B0B8C1]">
        TriPick 으로 만든 여행 일정
      </div>
    </div>
  );
});
