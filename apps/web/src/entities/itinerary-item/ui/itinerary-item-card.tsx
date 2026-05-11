'use client';

import type { PlannerItineraryItemDto } from '@tripick/types';

import { Chip } from '@/shared/ui';

const typeToneMap = {
  attraction: 'primary',
  cafe: 'primary',
  restaurant: 'primary',
  transport: 'neutral',
} as const;

type Props = {
  item: PlannerItineraryItemDto;
  onClick?: () => void;
  selected?: boolean;
};

export function ItineraryItemCard({ item, onClick, selected = false }: Props) {
  const tone = typeToneMap[item.type] ?? 'neutral';
  const cardClass = selected
    ? 'border-[#3182F6] bg-[#EAF2FF] shadow-[0_8px_24px_rgba(49,130,246,0.12)]'
    : 'border-[#E5E8EB] bg-white hover:border-[#C7DCFF] hover:bg-[#FAFBFC]';
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-stretch gap-3 text-left"
    >
      <div className="flex w-[54px] shrink-0 flex-col items-end pt-3 text-[13px] font-semibold leading-[18px] text-[#191F28]">
        {item.scheduledAt}
      </div>
      <div className="relative flex flex-col items-center pt-4">
        <span className={`size-2.5 rounded-full ${selected ? 'bg-[#1B64DA]' : 'bg-[#3182F6]'}`} />
        <span className="mt-1 h-full w-px bg-[#E5E8EB]" />
      </div>
      <div className={`flex-1 rounded-[16px] border px-4 py-3 transition ${cardClass}`}>
        <div className="flex items-center justify-between gap-2">
          <Chip tone={tone}>{item.typeLabel}</Chip>
          <span className="text-[#8B95A1]">&gt;</span>
        </div>
        <div className="mt-2 text-[16px] font-semibold leading-[24px] text-[#191F28]">
          {item.name}
        </div>
        <div className="mt-1 flex items-center gap-2 text-[13px] leading-[18px] text-[#6B7684]">
          <span>{item.durationLabel}</span>
          {item.hasWaiting ? (
            <span className="flex items-center gap-1 text-[#F04452]">
              <span aria-hidden>⚠</span>
              <span>
                웨이팅 {item.waitingMinutes ? `${item.waitingMinutes}분` : '있음'}
              </span>
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
}
