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

/**
 * @MX:ANCHOR: "하루의 빛" 타임라인 컨테이너 — 대상 화면(결과/플래너) 시그니처 패턴의
 * 정본 구현. 좌측 도트 칼럼(42px 시간 + 10px gap 열의 중심, ItineraryItemCard 의
 * 도트 위치와 정렬)에 4-stop 시간대 그라데이션 레일을 컨테이너 레벨로 한 번만 그리고,
 * 개별 도트 색은 ItineraryItemCard 내부에서 항목 시각 기준으로 결정된다(REQ-WVR-042).
 * @MX:REASON: fan_in — EditableTimeline(실사용 플래너 화면)과 이 위젯이 공유하는
 * ItineraryItemCard 를 감싸는 대표 컨테이너로, 결과 화면 재스타일링의 진입점.
 */
export function PlannerTimeline({
  items,
  onSelectItem,
  onSwitchItem,
  selectedItemId = null,
}: Props) {
  if (items.length === 0) {
    return (
      <div className="rounded-[16px] border border-[color:var(--line)] bg-[color:var(--card-soft)] p-5 text-center text-[14px] text-[color:var(--ink-sub)]">
        해당 일차에 등록된 일정이 없어요.
      </div>
    );
  }
  return (
    <div className="relative pb-4">
      {/* 컨테이너 레벨 4-stop "하루의 빛" 그라데이션 레일 (REQ-WVR-041) — 목업 .tl::before */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-2 left-[55px] top-2 w-[3px] rounded-full"
        style={{
          background:
            'linear-gradient(180deg, var(--t-morning) 0%, var(--t-noon) 36%, var(--t-gold) 70%, var(--t-dusk) 100%)',
        }}
      />
      <div className="relative space-y-2">
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
    </div>
  );
}
