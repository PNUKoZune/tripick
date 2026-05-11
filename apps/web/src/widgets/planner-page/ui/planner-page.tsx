'use client';

import { useEffect, useMemo, useState } from 'react';
import type {
  PlannerItineraryItemDto,
  PlannerMapMarkerDto,
  PlannerTripDto,
} from '@tripick/types';

import { DEMO_TRIP_ID, fetchPlannerTrip } from '@/entities/trip-plan';
import { MemberAvatars } from '@/entities/member';
import { DaySelector } from '@/features/day-selector';
import { PlannerTabs, type PlannerTab } from '@/features/planner-tab-switch';
import { Button, Chip } from '@/shared/ui';
import { AlternativeSheet } from '@/widgets/alternative-sheet';
import { PlannerBottomNav } from '@/widgets/planner-bottom-nav';
import { PlannerHeader } from '@/widgets/planner-header';
import { PlannerMap } from '@/widgets/planner-map';
import { PlannerTimeline } from '@/widgets/planner-timeline';
import { TripInfoPanel } from '@/widgets/trip-info-panel';
import { TripMapPanel } from '@/widgets/trip-map-panel';

export function PlannerPage() {
  const [trip, setTrip] = useState<PlannerTripDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<PlannerTab>('schedule');
  const [day, setDay] = useState(1);
  const [openItem, setOpenItem] = useState<PlannerItineraryItemDto | null>(null);
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  const [swapResult, setSwapResult] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPlannerTrip(DEMO_TRIP_ID)
      .then((result) => {
        if (cancelled) return;
        setTrip(result);
        setDay(result.days[0]?.day ?? 1);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : '여행 정보를 불러오지 못했어요.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const itemsForDay = useMemo(() => {
    if (!trip) return [];
    const base = trip.items.filter((item) => item.day === day);
    if (!swapResult) return base;
    return base.map((item) =>
      item.id === swapResult.id ? { ...item, name: swapResult.name, hasWaiting: false } : item,
    );
  }, [trip, day, swapResult]);

  const dayMarkers = useMemo<PlannerMapMarkerDto[]>(() => {
    if (!trip) return [];
    const itemIds = new Set(itemsForDay.map((i) => i.id));
    return trip.mapMarkers.filter((m) => !m.itemId || itemIds.has(m.itemId));
  }, [trip, itemsForDay]);

  const focusedMarker = useMemo<PlannerMapMarkerDto | null>(() => {
    if (!focusedItemId) return null;
    return dayMarkers.find((m) => m.itemId === focusedItemId) ?? null;
  }, [focusedItemId, dayMarkers]);

  const focusedMarkerId = focusedMarker?.id ?? null;
  const mapCenter = focusedMarker
    ? { lat: focusedMarker.lat, lng: focusedMarker.lng, level: 4 }
    : trip?.mapCenter ?? { lat: 35.8347, lng: 129.2247, level: 7 };

  return (
    <div className="min-h-dvh bg-[#F7F8FA]">
      {/* < lg : phone shell (모바일 우선) */}
      <div className="mx-auto max-w-[480px] px-4 py-6 lg:hidden">
        <div className="overflow-hidden rounded-[20px] border border-[#E5E8EB] bg-white shadow-[0_8px_24px_rgba(0,0,0,0.04)]">
          <PlannerHeader title={trip?.title ?? '일정 불러오는 중'} members={trip?.members ?? []} />

          {trip ? (
            <PlannerMap
              placeholder={trip.searchPlaceholder}
              center={trip.mapCenter}
              markers={trip.mapMarkers}
            />
          ) : (
            <div className="aspect-[390/290] bg-[#F2F4F6]" />
          )}

          <PlannerTabs value={tab} onChange={setTab} />

          {trip ? (
            <div className="px-4 pt-3">
              <DaySelector days={trip.days} value={day} onChange={setDay} />
            </div>
          ) : null}

          <div className="relative px-4 pb-4 pt-3">
            {loadError ? (
              <div className="rounded-[16px] border border-[#FECDD3] bg-[#FFECEE] p-4 text-[14px] text-[#F04452]">
                {loadError}
              </div>
            ) : null}

            {tab === 'schedule' ? (
              <PlannerTimeline items={itemsForDay} onSelectItem={setOpenItem} />
            ) : null}
            {tab === 'map' && trip ? (
              <TripMapPanel trip={trip} items={itemsForDay} onSelectItem={setOpenItem} />
            ) : null}
            {tab === 'info' && trip ? <TripInfoPanel trip={trip} /> : null}

            <button
              type="button"
              aria-label="AI 도움"
              onClick={() => setOpenItem(itemsForDay.find((i) => i.hasWaiting) ?? itemsForDay[0] ?? null)}
              className="absolute bottom-20 right-4 z-10 flex size-14 items-center justify-center rounded-full bg-[#3182F6] text-[14px] font-bold text-white shadow-[0_12px_24px_rgba(49,130,246,0.32)] active:translate-y-px"
            >
              AI
            </button>
          </div>

          <PlannerBottomNav active="trips" />
        </div>
      </div>

      {/* ≥ lg : 데스크탑 웹 레이아웃 */}
      <div className="hidden lg:grid lg:min-h-dvh lg:grid-rows-[auto_1fr]">
        <header className="border-b border-[#E5E8EB] bg-white">
          <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-6 px-8 py-4 xl:px-10">
            <div className="flex items-center gap-4">
              <div>
                <div className="text-[12px] font-semibold tracking-wide text-[#3182F6]">
                  TriPick · Main Planner
                </div>
                <h1 className="mt-0.5 text-[20px] font-bold leading-[28px] text-[#191F28]">
                  {trip?.title ?? '여행 정보 불러오는 중'}
                </h1>
              </div>
              {trip ? (
                <div className="flex items-center gap-2">
                  <Chip tone="neutral">{trip.meta.durationLabel}</Chip>
                  <Chip tone="neutral">{trip.meta.transportLabel}</Chip>
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-4">
              {trip ? <MemberAvatars members={trip.members} /> : null}
              <Button
                variant="primary"
                size="md"
                className="h-10 px-4 text-[14px]"
                onClick={() =>
                  setOpenItem(itemsForDay.find((i) => i.hasWaiting) ?? itemsForDay[0] ?? null)
                }
              >
                AI 대안 제안
              </Button>
            </div>
          </div>
        </header>

        <div className="mx-auto grid h-full w-full min-h-0 max-w-[1600px] grid-cols-[380px_minmax(0,1fr)] gap-5 px-8 py-6 xl:grid-cols-[420px_minmax(0,1fr)_360px] xl:gap-6 xl:px-10">
          {/* 좌측: 일정 패널 */}
          <aside className="flex h-[calc(100dvh-120px)] min-h-0 flex-col overflow-hidden rounded-[20px] border border-[#E5E8EB] bg-white shadow-[0_8px_24px_rgba(0,0,0,0.04)]">
            <div className="border-b border-[#E5E8EB] px-5 py-4">
              <div className="flex items-center justify-between">
                <h2 className="text-[18px] font-bold leading-[26px] text-[#191F28]">일정</h2>
                <span className="text-[12px] font-semibold text-[#8B95A1]">
                  {itemsForDay.length}개
                </span>
              </div>
              <p className="mt-1 text-[13px] leading-[20px] text-[#6B7684]">
                일자를 선택하고 일정을 클릭하면 우측 지도가 이동해요.
              </p>
              {trip ? (
                <div className="mt-3">
                  <DaySelector days={trip.days} value={day} onChange={setDay} />
                </div>
              ) : null}
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {loadError ? (
                <div className="rounded-[16px] border border-[#FECDD3] bg-[#FFECEE] p-4 text-[14px] text-[#F04452]">
                  {loadError}
                </div>
              ) : (
                <PlannerTimeline
                  items={itemsForDay}
                  selectedItemId={focusedItemId}
                  onSelectItem={(item) => {
                    if (focusedItemId === item.id) {
                      setOpenItem(item);
                    } else {
                      setFocusedItemId(item.id);
                    }
                  }}
                />
              )}
            </div>
            <div className="border-t border-[#E5E8EB] bg-[#FAFBFC] px-5 py-3 text-[12px] text-[#6B7684]">
              일정을 한 번 클릭하면 지도에서 초점이 맞춰지고, 다시 누르면 대안 시트가 열립니다.
            </div>
          </aside>

          {/* 중앙: 큰 지도 */}
          <main className="flex h-[calc(100dvh-120px)] min-h-0 flex-col overflow-hidden rounded-[20px] border border-[#E5E8EB] bg-white shadow-[0_8px_24px_rgba(0,0,0,0.04)]">
            {trip ? (
              <PlannerMap
                placeholder={trip.searchPlaceholder}
                center={mapCenter}
                markers={dayMarkers}
                selectedMarkerId={focusedMarkerId}
                showCurrentDot={false}
                fill
                onMarkerClick={(marker) => {
                  if (!marker.itemId) return;
                  if (focusedItemId === marker.itemId) {
                    const target = itemsForDay.find((i) => i.id === marker.itemId);
                    if (target) setOpenItem(target);
                  } else {
                    setFocusedItemId(marker.itemId);
                  }
                }}
              />
            ) : (
              <div className="flex-1 bg-[#F2F4F6]" />
            )}
          </main>

          {/* 우측: 정보 패널 (xl+) */}
          <aside className="hidden h-[calc(100dvh-120px)] min-h-0 overflow-y-auto xl:block">
            {trip ? <TripInfoPanel trip={trip} /> : null}
          </aside>
        </div>
      </div>

      <AlternativeSheet
        tripId={trip?.id ?? DEMO_TRIP_ID}
        open={openItem !== null}
        item={openItem}
        onClose={() => setOpenItem(null)}
        onApplied={(name, itemId) => setSwapResult({ id: itemId, name })}
      />
    </div>
  );
}
