'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  PlannerItineraryItemDto,
  PlannerMapCenterDto,
  PlannerTripDto,
  TripSummaryDto,
} from '@tripick/types';

import { SessionGuard } from '@/entities/session';
import { fetchPlannerTrip, fetchPlannerTrips, splitTripSchedule } from '@/entities/trip-plan';
import {
  DeviationBanner,
  useDeviationDetection,
  type NextPlace,
} from '@/features/detect-route-deviation';
import { ReplanToast, useReplanSubscription } from '@/features/subscribe-replan-result';
import { NextStopBar, useLiveEta, useTripProgress } from '@/features/track-trip-progress';
import { queryKeys } from '@/shared/api/query-keys';
import { LocationPermissionBanner, useCurrentLocation } from '@/shared/location';
import { AppBottomNavigation, AppDesktopNavigation } from '@/shared/ui/app-frame';
import { AlternativeSheet } from '@/widgets/alternative-sheet';
import { LiveMap } from '@/widgets/live-map';
import { TripProgressTimeline } from '@/widgets/trip-progress-timeline';

const DEFAULT_CENTER: PlannerMapCenterDto = { lat: 37.5665, lng: 126.978, level: 5 };

export function TripProgressView() {
  return (
    <SessionGuard>
      <TripProgressContent />
    </SessionGuard>
  );
}

function TripProgressContent() {
  const { data: trips = [], isLoading } = useQuery({
    queryKey: queryKeys.planner.trips,
    queryFn: fetchPlannerTrips,
    staleTime: 60 * 1000,
  });

  const { active, upcoming } = useMemo(() => splitTripSchedule(trips), [trips]);

  const { data: trip = null } = useQuery<PlannerTripDto>({
    queryKey: queryKeys.planner.trip(active?.id ?? 'pending'),
    queryFn: () => fetchPlannerTrip(active!.id),
    enabled: Boolean(active),
    staleTime: 60 * 1000,
  });

  // 오늘이 여행의 몇 일차인지 — 서버가 KST 기준으로 파생한 progress.currentDay 를 신뢰한다.
  const dayNumber = trip?.progress.currentDay ?? 1;

  const itemsForDay = useMemo(
    () => (trip ? trip.items.filter((item) => item.day === dayNumber) : []),
    [trip, dayNumber],
  );

  const { items: progressItems, nextItem } = useTripProgress(itemsForDay);
  const { position, permission } = useCurrentLocation({ enabled: Boolean(active) });
  const replan = useReplanSubscription(active?.id ?? '');
  const isReplanning =
    replan.latest?.status === 'pending' || replan.latest?.status === 'processing';

  const nextPlace = useMemo<NextPlace | null>(() => {
    if (!nextItem || !trip) return null;
    const marker = trip.mapMarkers.find((m) => m.itemId === nextItem.id);
    return marker ? { itemId: nextItem.id, lat: marker.lat, lng: marker.lng } : null;
  }, [nextItem, trip]);

  const deviation = useDeviationDetection({
    tripId: active?.id ?? '',
    position,
    nextPlace,
    enabled: Boolean(active),
  });

  // Live 화면에서 다음 장소까지 실경로 ETA 를 60초마다 폴링 (실패 시 NextStopBar 가 휴리스틱 폴백)
  const liveEta = useLiveEta({
    position,
    next: nextPlace ? { lat: nextPlace.lat, lng: nextPlace.lng } : null,
    transportLabel: trip?.meta.transportLabel,
    enabled: Boolean(active),
  });

  const dayMarkers = useMemo(() => {
    if (!trip) return [];
    const ids = new Set(itemsForDay.map((item) => item.id));
    return trip.mapMarkers.filter((m) => !m.itemId || ids.has(m.itemId));
  }, [trip, itemsForDay]);

  const [alternativeItem, setAlternativeItem] = useState<PlannerItineraryItemDto | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const selectedMarker = useMemo(
    () => dayMarkers.find((marker) => marker.itemId === selectedItemId) ?? null,
    [dayMarkers, selectedItemId],
  );

  if (!active) {
    return <TripProgressEmpty loading={isLoading} upcoming={upcoming} />;
  }

  return (
    <div className="bg-[#F7F8FA]">
      {/* 모바일 (< lg): 지도 위 + 일정 아래 풀스크린 셸 */}
      <div className="lg:hidden">
        <div className="mx-auto flex h-dvh max-w-[430px] flex-col overflow-hidden bg-white">
          <header className="flex shrink-0 items-center justify-between border-b border-[#E5E8EB] px-5 py-4">
            <div>
              <div className="text-[12px] font-bold tracking-wide text-[#3182F6]">여행 중</div>
              <h1 className="mt-0.5 text-[18px] font-bold leading-[26px] text-[#191F28]">
                {trip?.title ?? active.title}
              </h1>
            </div>
            <div className="flex items-center gap-2">
              {isReplanning ? <ReplanningPill /> : null}
              <span className="rounded-full bg-[#F2F4F6] px-3 py-1 text-[12px] font-bold text-[#4E5968]">
                {dayNumber}일차
              </span>
            </div>
          </header>

          <div className="h-[280px] w-full shrink-0">
            <LiveMap
              center={trip?.mapCenter ?? DEFAULT_CENTER}
              markers={dayMarkers}
              position={position}
              focusCoord={
                selectedMarker ? { lat: selectedMarker.lat, lng: selectedMarker.lng } : null
              }
              selectedMarkerId={selectedMarker?.id ?? null}
              onRecenterToCurrent={() => setSelectedItemId(null)}
            />
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-5 pb-[104px]">
            <LocationPermissionBanner permission={permission} />
            <NextStopBar
              item={nextItem}
              distanceM={deviation.distanceM}
              transportLabel={trip?.meta.transportLabel}
              etaMinOtp={liveEta.etaMin}
            />
            <TripProgressTimeline
              items={progressItems}
              selectedItemId={selectedItemId}
              onSelectItem={(item) => setSelectedItemId(item.id)}
              onSwitchItem={setAlternativeItem}
            />
          </div>
        </div>
        <AppBottomNavigation className="lg:hidden" />
      </div>

      {/* 태블릿·PC (≥ lg): 좌측 네비 + 큰 지도 + 우측 일정 패널 */}
      <div className="mx-auto hidden h-dvh w-full max-w-[1640px] lg:grid lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-6 lg:px-6">
        <AppDesktopNavigation />
        <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_380px] overflow-hidden border-x border-[#E5E8EB] bg-white xl:grid-cols-[minmax(0,1fr)_440px]">
          <main className="relative min-h-0">
            <LiveMap
              center={trip?.mapCenter ?? DEFAULT_CENTER}
              markers={dayMarkers}
              position={position}
              focusCoord={
                selectedMarker ? { lat: selectedMarker.lat, lng: selectedMarker.lng } : null
              }
              selectedMarkerId={selectedMarker?.id ?? null}
              onRecenterToCurrent={() => setSelectedItemId(null)}
            />
          </main>

          <aside className="flex min-h-0 flex-col overflow-hidden border-l border-[#E5E8EB]">
            <header className="flex shrink-0 items-center justify-between border-b border-[#E5E8EB] px-5 py-4">
              <div>
                <div className="text-[12px] font-bold tracking-wide text-[#3182F6]">여행 중</div>
                <h1 className="mt-0.5 text-[18px] font-bold leading-[26px] text-[#191F28]">
                  {trip?.title ?? active.title}
                </h1>
              </div>
              <span className="rounded-full bg-[#F2F4F6] px-3 py-1 text-[12px] font-bold text-[#4E5968]">
                {dayNumber}일차
              </span>
            </header>
            <div className="flex-1 overflow-y-auto px-4 py-5">
              <LocationPermissionBanner permission={permission} />
              <NextStopBar
                item={nextItem}
                distanceM={deviation.distanceM}
                transportLabel={trip?.meta.transportLabel}
                etaMinOtp={liveEta.etaMin}
              />
              <TripProgressTimeline
                items={progressItems}
                selectedItemId={selectedItemId}
                onSelectItem={(item) => setSelectedItemId(item.id)}
                onSwitchItem={setAlternativeItem}
              />
            </div>
          </aside>
        </div>
      </div>

      <DeviationBanner
        open={deviation.deviated}
        distanceM={deviation.distanceM}
        onConfirm={deviation.confirm}
        onDismiss={deviation.dismiss}
        reporting={deviation.isReporting}
      />

      <AlternativeSheet
        tripId={active.id}
        open={alternativeItem !== null}
        item={alternativeItem}
        onClose={() => setAlternativeItem(null)}
        onApplied={() => setAlternativeItem(null)}
      />

      <ReplanToast tripId={active.id} subscription={replan} />
    </div>
  );
}

/** 헤더에 표시되는 "AI 재계획 중" 진행 핀 (replan pending/processing 동안). */
function ReplanningPill() {
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-[#EAF2FF] px-2.5 py-1 text-[11px] font-bold text-[#1B64DA]">
      <span className="size-1.5 animate-pulse rounded-full bg-[#3182F6]" />
      AI 재계획 중
    </span>
  );
}

function TripProgressEmpty({
  loading,
  upcoming,
}: {
  loading: boolean;
  upcoming: TripSummaryDto[];
}) {
  return (
    <div className="min-h-dvh bg-[#F7F8FA]">
      <div className="mx-auto min-h-dvh max-w-[430px] bg-white pb-[88px]">
        <header className="px-5 pb-4 pt-8">
          <div className="text-[12px] font-bold tracking-wide text-[#3182F6]">여행 중</div>
          <h1 className="mt-0.5 text-[22px] font-bold leading-8 text-[#191F28]">실시간 여행</h1>
        </header>

        <div className="px-5">
          <div className="rounded-[16px] border border-[#E5E8EB] bg-[#FAFBFC] px-4 py-6 text-center">
            <div className="text-[15px] font-bold text-[#191F28]">
              {loading ? '여행을 확인하는 중…' : '지금 진행 중인 여행이 없어요'}
            </div>
            {!loading ? (
              <p className="mt-1 text-[13px] leading-5 text-[#6B7684]">
                여행 시작일이 되면 여기서 현재 위치와 일정을 실시간으로 안내해드려요.
              </p>
            ) : null}
          </div>

          {upcoming.length > 0 ? (
            <div className="mt-6">
              <div className="text-[13px] font-bold text-[#4E5968]">다가오는 여행</div>
              <ul className="mt-2 space-y-2">
                {upcoming.map((tripItem) => (
                  <li key={tripItem.id}>
                    <Link
                      href={`/planner?tripId=${tripItem.id}`}
                      className="flex items-center gap-3 rounded-[14px] border border-[#E5E8EB] bg-white px-4 py-3 hover:bg-[#FAFBFC]"
                    >
                      <span className="text-[22px]">{tripItem.coverEmoji}</span>
                      <div className="min-w-0">
                        <div className="truncate text-[15px] font-bold text-[#191F28]">
                          {tripItem.title}
                        </div>
                        <div className="mt-0.5 text-[12px] font-medium text-[#8B95A1]">
                          {tripItem.durationLabel} · {tripItem.destination}
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      <AppBottomNavigation />
    </div>
  );
}
