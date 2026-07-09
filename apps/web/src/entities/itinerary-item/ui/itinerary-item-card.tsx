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
  /** 카드 본문 탭 — 지도 초점 이동 등 */
  onClick?: () => void;
  /** 대안 시트를 여는 "전환" 버튼. 없으면 버튼 미표시 */
  onSwitch?: () => void;
  selected?: boolean;
};

export function ItineraryItemCard({ item, onClick, onSwitch, selected = false }: Props) {
  const tone = typeToneMap[item.type] ?? 'neutral';
  const cardClass = selected
    ? 'border-[#3182F6] bg-[#EAF2FF] shadow-[0_8px_24px_rgba(49,130,246,0.12)]'
    : 'border-[#E5E8EB] bg-white hover:border-[#C7DCFF] hover:bg-[#FAFBFC]';
  return (
    <div className="flex w-full items-stretch gap-3 text-left">
      <div className="flex w-[54px] shrink-0 flex-col items-end pt-3 text-[13px] font-semibold leading-[18px] text-[#191F28]">
        {item.scheduledAt}
      </div>
      <div className="relative flex flex-col items-center pt-4">
        <span className={`size-2.5 rounded-full ${selected ? 'bg-[#1B64DA]' : 'bg-[#3182F6]'}`} />
        <span className="mt-1 h-full w-px bg-[#E5E8EB]" />
      </div>
      <div className={`relative flex-1 rounded-[16px] border px-4 py-3 transition ${cardClass}`}>
        <button type="button" onClick={onClick} className="block w-full text-left">
          <div className="flex items-center justify-between gap-2">
            <Chip tone={tone}>{item.typeLabel}</Chip>
            {onSwitch ? <span className="h-6" /> : <span className="text-[#8B95A1]">&gt;</span>}
          </div>
          <div className="mt-2 pr-16 text-[16px] font-semibold leading-[24px] text-[#191F28]">
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
        </button>
        {onSwitch ? (
          <button
            type="button"
            onClick={onSwitch}
            className={`absolute right-3 top-3 flex h-8 items-center gap-1 rounded-full px-3 text-[13px] font-bold transition active:translate-y-px ${
              item.hasWaiting
                ? 'bg-[#F04452] text-white hover:bg-[#E0303E]'
                : 'bg-[#3182F6] text-white hover:bg-[#1B64DA]'
            }`}
          >
            전환
          </button>
        ) : null}
      </div>
    </div>
  );
}
