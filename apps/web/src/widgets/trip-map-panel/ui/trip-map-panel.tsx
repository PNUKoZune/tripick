'use client';

import { useMemo, useState } from 'react';
import type { PlannerItineraryItemDto, PlannerMapMarkerDto, PlannerTripDto } from '@tripick/types';

import { ChangeScheduleButton } from '@/shared/ui';
import { PlannerMap } from '@/widgets/planner-map';

type Props = {
  trip: PlannerTripDto;
  items: PlannerItineraryItemDto[];
  onSelectItem: (item: PlannerItineraryItemDto) => void;
};

export function TripMapPanel({ trip, items, onSelectItem }: Props) {
  const [selectedItemId, setSelectedItemId] = useState<string | null>(items[0]?.id ?? null);

  // 현재 day 의 itemId 집합과 마커를 교차해 day 마커만 표시
  const dayMarkers = useMemo<PlannerMapMarkerDto[]>(() => {
    const itemIds = new Set(items.map((i) => i.id));
    return trip.mapMarkers.filter((m) => !m.itemId || itemIds.has(m.itemId));
  }, [trip.mapMarkers, items]);

  const markerIdByItemId = useMemo(() => {
    const map = new Map<string, string>();
    dayMarkers.forEach((m) => {
      if (m.itemId) map.set(m.itemId, m.id);
    });
    return map;
  }, [dayMarkers]);

  const selectedMarkerId = selectedItemId ? (markerIdByItemId.get(selectedItemId) ?? null) : null;

  const center = useMemo(() => {
    if (!selectedItemId) return trip.mapCenter;
    const marker = dayMarkers.find((m) => m.itemId === selectedItemId);
    if (!marker) return trip.mapCenter;
    return { lat: marker.lat, lng: marker.lng, level: 4 };
  }, [trip.mapCenter, dayMarkers, selectedItemId]);

  return (
    <div className="space-y-3 pb-4">
      <div className="overflow-hidden rounded-[16px] border border-[color:var(--line,#E5E8EB)]">
        <PlannerMap
          placeholder={trip.searchPlaceholder}
          center={center}
          markers={dayMarkers}
          selectedMarkerId={selectedMarkerId}
          showCurrentDot={false}
          showSearch={false}
          aspect="aspect-[4/5]"
          onMarkerClick={(marker) => {
            if (marker.itemId) setSelectedItemId(marker.itemId);
          }}
        />
      </div>

      <ul className="space-y-2">
        {items.map((item) => {
          const isSelected = item.id === selectedItemId;
          return (
            <li key={item.id}>
              <div
                className={`flex w-full items-center gap-3 rounded-[16px] border px-3 py-2 text-left transition ${
                  isSelected
                    ? 'border-[color:var(--primary,#3182F6)] bg-[color:var(--primary-tint,#EAF2FF)]'
                    : 'border-[color:var(--line,#E5E8EB)] bg-[color:var(--card,#fff)] hover:bg-[color:var(--card-soft,#FAFBFC)]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setSelectedItemId(item.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span
                    className={`num-badge flex size-7 shrink-0 items-center justify-center rounded-full border text-[12px] font-bold ${
                      isSelected
                        ? 'bg-[color:var(--primary-deep,#1B64DA)] text-white border-[color:var(--primary-deep,#1B64DA)]'
                        : 'bg-[color:var(--primary,#3182F6)] text-white border-[color:var(--primary-deep,#1B64DA)]'
                    }`}
                  >
                    {markerIdByItemId.get(item.id)
                      ? items.findIndex((i) => i.id === item.id) + 1
                      : '·'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[12px] text-[color:var(--ink-sub,#6B7684)]">
                      <span>{item.scheduledAt}</span>
                      <span>·</span>
                      <span>{item.typeLabel}</span>
                    </div>
                    <div className="truncate text-[14px] font-semibold text-[color:var(--ink,#191F28)]">
                      {item.name}
                    </div>
                  </div>
                </button>
                <ChangeScheduleButton onClick={() => onSelectItem(item)} className="shrink-0" />
              </div>
            </li>
          );
        })}
        {items.length === 0 ? (
          <li className="rounded-[16px] border border-[color:var(--line,#E5E8EB)] bg-[color:var(--card-soft,#FAFBFC)] px-3 py-4 text-center text-[13px] text-[color:var(--ink-faint,#8B95A1)]">
            해당 일차에 일정이 없어요.
          </li>
        ) : null}
      </ul>

      <p className="text-center text-[12px] text-[color:var(--ink-faint,#8B95A1)]">
        카드 탭 → 지도 이동 · 변경 아이콘 → 대안 보기
      </p>
    </div>
  );
}
