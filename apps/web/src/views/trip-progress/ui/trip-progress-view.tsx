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
import { WaitingReportSheet } from '@/features/report-waiting';
import { ReplanToast } from '@/features/subscribe-replan-result';
import { useTripProgress } from '@/features/track-trip-progress';
import { queryKeys } from '@/shared/api/query-keys';
import { useCurrentLocation } from '@/shared/location';
import { AppBottomNavigation } from '@/shared/ui/app-frame';
import { LiveMap } from '@/widgets/live-map';
import { TripProgressTimeline } from '@/widgets/trip-progress-timeline';

const DEFAULT_CENTER: PlannerMapCenterDto = { lat: 37.5665, lng: 126.978, level: 5 };

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

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

  // 오늘이 여행의 몇 일차인지 (startDate 기준)
  const dayNumber = useMemo(() => {
    if (!trip) return 1;
    const start = startOfDay(new Date(trip.meta.startDate));
    const diff = Math.floor((startOfDay(new Date()) - start) / 86_400_000) + 1;
    return Math.min(Math.max(diff, 1), trip.days.length || 1);
  }, [trip]);

  const itemsForDay = useMemo(
    () => (trip ? trip.items.filter((item) => item.day === dayNumber) : []),
    [trip, dayNumber],
  );

  const { items: progressItems, nextItem } = useTripProgress(itemsForDay);
  const { position } = useCurrentLocation({ enabled: Boolean(active) });

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

  const dayMarkers = useMemo(() => {
    if (!trip) return [];
    const ids = new Set(itemsForDay.map((item) => item.id));
    return trip.mapMarkers.filter((m) => !m.itemId || ids.has(m.itemId));
  }, [trip, itemsForDay]);

  const [waitingItem, setWaitingItem] = useState<PlannerItineraryItemDto | null>(null);

  if (!active) {
    return <TripProgressEmpty loading={isLoading} upcoming={upcoming} />;
  }

  return (
    <div className="min-h-dvh bg-[#F7F8FA]">
      <div className="mx-auto min-h-dvh max-w-[430px] bg-white pb-[88px]">
        <header className="flex items-center justify-between border-b border-[#E5E8EB] px-5 py-4">
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

        <div className="h-[280px] w-full">
          <LiveMap
            center={trip?.mapCenter ?? DEFAULT_CENTER}
            markers={dayMarkers}
            position={position}
          />
        </div>

        <div className="px-4 py-5">
          <TripProgressTimeline items={progressItems} onReportWaiting={setWaitingItem} />
        </div>
      </div>

      <AppBottomNavigation />

      <DeviationBanner
        open={deviation.deviated}
        distanceM={deviation.distanceM}
        onConfirm={deviation.confirm}
        onDismiss={deviation.dismiss}
        reporting={deviation.isReporting}
      />

      <WaitingReportSheet
        open={waitingItem !== null}
        onClose={() => setWaitingItem(null)}
        tripId={active.id}
        item={waitingItem}
        position={position}
      />

      <ReplanToast tripId={active.id} />
    </div>
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
