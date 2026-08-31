'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PlannerItineraryItemDto, PlannerMapMarkerDto, SharedItineraryDto } from '@tripick/types';

import { fetchSharedItinerary } from '@/entities/trip-plan';
import { ItineraryItemCard } from '@/entities/itinerary-item';
import { DaySelector } from '@/features/day-selector';
import { queryKeys } from '@/shared/api/query-keys';
import { PlannerMap } from '@/widgets/planner-map';

export function SharedTripView({ token }: { token: string }) {
  const [day, setDay] = useState(1);
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);

  const { data, error, isLoading } = useQuery<SharedItineraryDto>({
    queryKey: queryKeys.planner.shared(token),
    queryFn: () => fetchSharedItinerary(token),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const itemsForDay = useMemo(
    () => (data ? data.items.filter((item) => item.day === day) : []),
    [data, day],
  );

  const dayMarkers = useMemo<PlannerMapMarkerDto[]>(() => {
    if (!data) return [];
    const ids = new Set(itemsForDay.map((i) => i.id));
    return data.mapMarkers.filter((m) => !m.itemId || ids.has(m.itemId));
  }, [data, itemsForDay]);

  const focusedMarker = focusedItemId
    ? (dayMarkers.find((m) => m.itemId === focusedItemId) ?? null)
    : null;
  const mapCenter = focusedMarker
    ? { lat: focusedMarker.lat, lng: focusedMarker.lng, level: 4 }
    : (data?.mapCenter ?? { lat: 35.8347, lng: 129.2247, level: 7 });

  if (isLoading) {
    return <CenterMessage title="일정을 불러오는 중…" />;
  }
  if (error || !data) {
    return (
      <CenterMessage
        title="공유된 일정을 찾을 수 없어요"
        description="링크가 만료되었거나 공유가 중지되었을 수 있어요."
      />
    );
  }

  return (
    <div className="min-h-dvh bg-[#F7F8FA]">
      <div className="mx-auto min-h-dvh max-w-[480px] bg-white pb-[calc(32px+var(--safe-bottom))]">
        <header className="border-b border-[#E5E8EB] px-5 pb-4 pt-[calc(24px+var(--safe-top))]">
          <div className="text-[12px] font-bold tracking-wide text-[#3182F6]">TRIPICK · 공유된 일정</div>
          <h1 className="mt-1 text-[22px] font-bold leading-[30px] text-[#191F28]">{data.title}</h1>
          <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-[13px] text-[#6B7684]">
            <span>{data.destination}</span>
            <span aria-hidden>·</span>
            <span>{data.durationLabel}</span>
            <span aria-hidden>·</span>
            <span>{data.transportLabel}</span>
            {data.memberCount > 0 ? (
              <>
                <span aria-hidden>·</span>
                <span>멤버 {data.memberCount}명</span>
              </>
            ) : null}
          </div>
        </header>

        <PlannerMap
          placeholder={`${data.destination} 장소`}
          center={mapCenter}
          markers={dayMarkers}
          fitMarkers={!focusedMarker}
          selectedMarkerId={focusedMarker?.id ?? null}
          showCurrentDot={false}
          showSearch={false}
        />

        <div className="px-4 pt-3">
          <DaySelector days={data.days} value={day} onChange={setDay} />
        </div>

        <div className="px-4 pb-8 pt-3">
          {itemsForDay.length === 0 ? (
            <div className="rounded-[16px] border border-[#E5E8EB] bg-[#FAFBFC] p-5 text-center text-[14px] text-[#6B7684]">
              이 날짜에 등록된 일정이 없어요.
            </div>
          ) : (
            <div className="space-y-2">
              {itemsForDay.map((item: PlannerItineraryItemDto, index) => (
                <ItineraryItemCard
                  key={item.id}
                  item={item}
                  selected={item.id === focusedItemId}
                  isLast={index === itemsForDay.length - 1}
                  onClick={() => setFocusedItemId(item.id)}
                />
              ))}
            </div>
          )}

          <Link
            href="/"
            className="mt-6 flex h-12 w-full items-center justify-center rounded-[12px] bg-[#3182F6] text-[15px] font-bold text-white hover:bg-[#1B64DA]"
          >
            나도 TriPick 으로 여행 만들기
          </Link>
        </div>
      </div>
    </div>
  );
}

function CenterMessage({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[#F7F8FA] px-6 text-center">
      <div className="text-[16px] font-bold text-[#191F28]">{title}</div>
      {description ? <p className="mt-2 text-[13px] text-[#8B95A1]">{description}</p> : null}
      <Link
        href="/"
        className="mt-5 inline-flex h-11 items-center rounded-full bg-[#3182F6] px-5 text-[14px] font-bold text-white hover:bg-[#1B64DA]"
      >
        TriPick 시작하기
      </Link>
    </div>
  );
}
