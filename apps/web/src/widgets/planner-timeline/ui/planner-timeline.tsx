'use client';

import type { PlannerItineraryItemDto } from '@tripick/types';

import { ItineraryItemCard } from '@/entities/itinerary-item';

type Props = {
  items: PlannerItineraryItemDto[];
  /** 카드 본문 탭 — 지도 초점 이동 */
  onSelectItem: (item: PlannerItineraryItemDto) => void;
  /** "전환" 버튼 — 대안 시트 열기 */
  onSwitchItem?: (item: PlannerItineraryItemDto) => void;
  selectedItemId?: string | null;
};

export function PlannerTimeline({
  items,
  onSelectItem,
  onSwitchItem,
  selectedItemId = null,
}: Props) {
  if (items.length === 0) {
    return (
      <div className="rounded-[16px] border border-[#E5E8EB] bg-[#FAFBFC] p-5 text-center text-[14px] text-[#6B7684]">
        해당 일차에 등록된 일정이 없어요.
      </div>
    );
  }
  return (
    <div className="space-y-2 pb-4">
      {items.map((item, index) => (
        <ItineraryItemCard
          key={item.id}
          item={item}
          selected={item.id === selectedItemId}
          isLast={index === items.length - 1}
          onClick={() => onSelectItem(item)}
          {...(onSwitchItem ? { onSwitch: () => onSwitchItem(item) } : {})}
        />
      ))}
    </div>
  );
}
