'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PlannerItineraryItemDto, PlannerMapMarkerDto, PlannerTripDto } from '@tripick/types';

import { SessionGuard } from '@/entities/session';
import { fetchPlannerTrip, fetchPlannerTrips, isTripPeriodActive } from '@/entities/trip-plan';
import { MemberAvatars } from '@/entities/member';
import { DaySelector } from '@/features/day-selector';
import { TripMembersSheet } from '@/features/manage-trip-members';
import { PlannerTabs, type PlannerTab } from '@/features/planner-tab-switch';
import { ReplanToast } from '@/features/subscribe-replan-result';
import { queryKeys } from '@/shared/api/query-keys';
import { Button, Chip } from '@/shared/ui';
import { AppBottomNavigation, AppDesktopNavigation } from '@/shared/ui/app-frame';
import { AlternativeSheet } from '@/widgets/alternative-sheet';
import { PlannerHeader } from '@/widgets/planner-header';
import { PlannerMap } from '@/widgets/planner-map';
import { PlannerTimeline } from '@/widgets/planner-timeline';
import { TripCoordinationPanel } from '@/widgets/trip-coordination-panel';
import { TripInfoPanel } from '@/widgets/trip-info-panel';
import { TripMapPanel } from '@/widgets/trip-map-panel';

export function PlannerView({ tripId }: { tripId?: string }) {
  return (
    <SessionGuard>
      <PlannerContent {...(tripId ? { tripId } : {})} />
    </SessionGuard>
  );
}

function PlannerContent({ tripId }: { tripId?: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<PlannerTab>('schedule');
  const [day, setDay] = useState(1);
  const [openItem, setOpenItem] = useState<PlannerItineraryItemDto | null>(null);
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  const [swapResult, setSwapResult] = useState<{ id: string; name: string } | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);

  const {
    data: trips = [],
    error: tripsError,
    isLoading: isTripsLoading,
  } = useQuery({
    queryKey: queryKeys.planner.trips,
    queryFn: fetchPlannerTrips,
    enabled: !tripId,
    staleTime: 5 * 60 * 1000,
  });

  const firstTripId = trips[0]?.id;
  const selectedTripId = tripId ?? firstTripId ?? '';

  useEffect(() => {
    if (!tripId && firstTripId) {
      router.replace(`/planner?tripId=${firstTripId}`);
    }
  }, [firstTripId, router, tripId]);

  const { data: trip = null, error } = useQuery<PlannerTripDto>({
    queryKey: queryKeys.planner.trip(selectedTripId || 'pending'),
    queryFn: () => fetchPlannerTrip(selectedTripId),
    enabled: Boolean(selectedTripId),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (trip) {
      setDay((current) =>
        trip.days.some((item) => item.day === current) ? current : (trip.days[0]?.day ?? 1),
      );
    }
  }, [trip]);

  const loadError =
    error instanceof Error
      ? error.message
      : tripsError instanceof Error
        ? tripsError.message
        : null;
  const isResolvingTrip = !selectedTripId && isTripsLoading;
  const isLiveActive = trip ? isTripPeriodActive(trip.meta.startDate, trip.meta.endDate) : false;

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
    : (trip?.mapCenter ?? { lat: 35.8347, lng: 129.2247, level: 7 });

  return (
    <div className="min-h-dvh bg-[#F7F8FA]">
      {/* < lg : phone shell (모바일 우선) */}
      <div className="mx-auto min-h-dvh max-w-[430px] bg-white pb-[88px] lg:hidden">
        <PlannerHeader
          title={trip?.title ?? (isResolvingTrip ? '여행 찾는 중' : '여행을 먼저 만들어주세요')}
          members={trip?.members ?? []}
          {...(trip ? { onMembersClick: () => setMembersOpen(true) } : {})}
        />

        {isLiveActive ? <LivePromoBanner /> : null}

        {trip ? (
          <PlannerMap
            placeholder={trip.searchPlaceholder}
            center={mapCenter}
            markers={dayMarkers}
          />
        ) : (
          <div className="flex aspect-[390/290] items-center justify-center bg-[#F2F4F6] px-5 text-center text-[13px] font-semibold text-[#8B95A1]">
            {isResolvingTrip ? '내 여행을 찾는 중' : '새 여행을 만들면 일정과 지도가 표시돼요'}
          </div>
        )}

        {selectedTripId ? <PlannerTabs value={tab} onChange={setTab} /> : null}

        {trip && tab !== 'coordination' ? (
          <div className="px-4 pt-3">
            <DaySelector days={trip.days} value={day} onChange={setDay} />
          </div>
        ) : null}

        <div className="relative px-4 pb-8 pt-3">
          {loadError ? (
            <div className="rounded-[16px] border border-[#FECDD3] bg-[#FFECEE] p-4 text-[14px] text-[#F04452]">
              {loadError}
            </div>
          ) : null}

          {!selectedTripId && !loadError ? <PlannerEmptyState loading={isResolvingTrip} /> : null}

          {tab === 'schedule' && selectedTripId ? (
            <PlannerTimeline items={itemsForDay} onSelectItem={setOpenItem} />
          ) : null}
          {tab === 'map' && trip ? (
            <TripMapPanel trip={trip} items={itemsForDay} onSelectItem={setOpenItem} />
          ) : null}
          {tab === 'info' && trip ? <TripInfoPanel trip={trip} /> : null}
          {tab === 'coordination' && trip ? <TripCoordinationPanel tripId={trip.id} /> : null}

          {trip ? (
            <button
              type="button"
              aria-label="AI 도움"
              onClick={() =>
                setOpenItem(itemsForDay.find((i) => i.hasWaiting) ?? itemsForDay[0] ?? null)
              }
              className="fixed bottom-[96px] z-20 flex size-14 items-center justify-center rounded-full bg-[#3182F6] text-[14px] font-bold text-white shadow-[0_12px_24px_rgba(49,130,246,0.32)] active:translate-y-px lg:hidden"
              style={{ right: 'max(20px, calc((100vw - 430px) / 2 + 20px))' }}
            >
              AI
            </button>
          ) : null}
        </div>
      </div>
      <AppBottomNavigation className="lg:hidden" />

      {/* ≥ lg : 데스크탑 웹 레이아웃 */}
      <div className="mx-auto hidden w-full max-w-[1640px] lg:grid lg:min-h-dvh lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-6 lg:px-6">
        <AppDesktopNavigation />
        <div className="min-h-dvh overflow-hidden border-x border-[#E5E8EB] bg-white">
          <header className="border-b border-[#E5E8EB] bg-white">
            <div className="mx-auto flex w-full max-w-[1360px] items-center justify-between gap-6 px-8 py-4 xl:px-10">
              <div className="flex items-center gap-4">
                <Link
                  href="/trips"
                  className="flex h-9 items-center gap-1 rounded-[12px] border border-[#E5E8EB] bg-white px-3 text-[13px] font-semibold text-[#6B7684] hover:bg-[#FAFBFC] hover:text-[#191F28]"
                >
                  <span aria-hidden>‹</span>
                  <span>내 여행</span>
                </Link>
                <div>
                  <div className="text-[12px] font-semibold tracking-wide text-[#3182F6]">
                    Tripick · 일정
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
                {trip ? (
                  <button
                    type="button"
                    onClick={() => setMembersOpen(true)}
                    aria-label="여행 멤버 관리"
                    className="flex items-center gap-2 rounded-full px-2 py-1 transition hover:bg-[#F2F4F6]"
                  >
                    <MemberAvatars members={trip.members} />
                    <span className="text-[16px] text-[#8B95A1]" aria-hidden>
                      ＋
                    </span>
                  </button>
                ) : null}
                {trip ? (
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
                ) : null}
              </div>
            </div>
          </header>

          {isLiveActive ? <LivePromoBanner /> : null}

          <div className="mx-auto grid h-full w-full min-h-0 max-w-[1360px] grid-cols-[360px_minmax(0,1fr)] gap-5 px-8 py-6 xl:grid-cols-[400px_minmax(0,1fr)] xl:gap-6 xl:px-10 2xl:grid-cols-[420px_minmax(0,1fr)_360px]">
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
                ) : !selectedTripId ? (
                  <PlannerEmptyState loading={isResolvingTrip} />
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
                <div className="flex flex-1 items-center justify-center bg-[#F2F4F6] px-6 text-center text-[14px] font-semibold text-[#8B95A1]">
                  {isResolvingTrip ? '내 여행을 찾는 중' : '새 여행을 만들면 지도가 표시돼요'}
                </div>
              )}
            </main>

            {/* 우측: 정보 + 조율 패널 (2xl+) */}
            <aside className="hidden h-[calc(100dvh-120px)] min-h-0 space-y-4 overflow-y-auto 2xl:block">
              {trip ? <TripInfoPanel trip={trip} /> : null}
              {trip ? <TripCoordinationPanel tripId={trip.id} /> : null}
            </aside>
          </div>
        </div>
      </div>

      <AlternativeSheet
        tripId={trip?.id ?? selectedTripId}
        open={openItem !== null}
        item={openItem}
        onClose={() => setOpenItem(null)}
        onApplied={(name, itemId) => setSwapResult({ id: itemId, name })}
      />

      <TripMembersSheet
        open={membersOpen}
        onClose={() => setMembersOpen(false)}
        tripId={trip?.id ?? selectedTripId}
        tripTitle={trip?.title ?? '여행'}
        members={trip?.members ?? []}
      />

      {selectedTripId ? <ReplanToast tripId={selectedTripId} /> : null}
    </div>
  );
}

function LivePromoBanner() {
  return (
    <Link
      href="/trip/live"
      className="flex items-center justify-between gap-3 bg-[#3182F6] px-4 py-2.5 text-white transition hover:bg-[#1B64DA]"
    >
      <span className="flex items-center gap-2 text-[13px] font-bold">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-white/70" />
          <span className="relative inline-flex size-2 rounded-full bg-white" />
        </span>
        지금 여행 중이에요
      </span>
      <span className="text-[12px] font-semibold">실시간 화면 보기 ›</span>
    </Link>
  );
}

function PlannerEmptyState({ loading }: { loading: boolean }) {
  if (loading) {
    return (
      <div className="rounded-[16px] border border-[#E5E8EB] bg-[#FAFBFC] px-4 py-5 text-[14px] font-semibold text-[#8B95A1]">
        내 여행을 불러오고 있어요.
      </div>
    );
  }

  return (
    <div className="rounded-[16px] border border-[#E5E8EB] bg-[#FAFBFC] px-4 py-5">
      <div className="text-[12px] font-bold text-[#3182F6]">내 여행</div>
      <h2 className="mt-1 text-[18px] font-bold text-[#191F28]">여행을 먼저 만들어주세요</h2>
      <p className="mt-1 text-[13px] leading-5 text-[#6B7684]">
        일정·지도·취향 조율은 여행 단위로 저장됩니다.
      </p>
      <Link
        href="/trips/new"
        className="mt-4 inline-flex h-10 items-center rounded-full bg-[#3182F6] px-4 text-[13px] font-bold text-white hover:bg-[#1B64DA]"
      >
        새 여행 만들기
      </Link>
    </div>
  );
}
