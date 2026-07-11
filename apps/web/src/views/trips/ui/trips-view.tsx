'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { TripSummaryStatus, TripSummaryDto } from '@tripick/types';

import { SessionGuard } from '@/entities/session';
import { fetchPlannerTrips, TripSummaryCard } from '@/entities/trip-plan';
import { queryKeys } from '@/shared/api/query-keys';
import { AppFrame, PageContainer, PageHeader } from '@/shared/ui/app-frame';

type Filter = 'all' | TripSummaryStatus;

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'upcoming', label: '출발 전' },
  { value: 'ongoing', label: '진행 중' },
  { value: 'done', label: '다녀옴' },
];

export function TripsView() {
  return (
    <SessionGuard>
      <TripsContent />
    </SessionGuard>
  );
}

function TripsContent() {
  const [filter, setFilter] = useState<Filter>('all');

  const { data: trips = [], error } = useQuery({
    queryKey: queryKeys.planner.trips,
    queryFn: fetchPlannerTrips,
    staleTime: 5 * 60 * 1000,
  });

  const loadError = error instanceof Error ? error.message : null;

  const filtered = useMemo(() => {
    if (filter === 'all') return trips;
    return trips.filter((t) => t.status === filter);
  }, [trips, filter]);

  const stats = useMemo(() => {
    const upcoming = trips.filter((t) => t.status === 'upcoming').length;
    const ongoing = trips.filter((t) => t.status === 'ongoing').length;
    const done = trips.filter((t) => t.status === 'done').length;
    return { upcoming, ongoing, done };
  }, [trips]);
  const latestTrip = trips[0];

  return (
    <AppFrame>
      <PageHeader
        title="내 여행"
        label="내 여행"
        description="지금까지 만든 여행 계획을 한 곳에서 관리하세요."
        action={
          <>
            <Link
              href={latestTrip ? `/planner?tripId=${latestTrip.id}` : '/trips/new'}
              className="hidden rounded-[14px] border border-[#E5E8EB] bg-white px-4 py-2 text-[14px] font-semibold text-[#191F28] hover:bg-[#FAFBFC] lg:inline-flex"
            >
              {latestTrip ? '최근 여행 일정 보기' : '첫 여행 만들기'}
            </Link>
            <Link
              href="/trips/new"
              className="inline-flex h-10 items-center gap-1 rounded-full bg-[#3182F6] px-4 text-[13px] font-bold text-white shadow-[0_6px_16px_rgba(49,130,246,0.28)] hover:bg-[#1B64DA] lg:gap-0 lg:rounded-[14px] lg:px-4 lg:text-[14px] lg:font-semibold lg:shadow-none"
            >
              <span aria-hidden className="lg:hidden">
                ＋
              </span>
              <span>새 여행</span>
            </Link>
          </>
        }
      />
      <PageContainer>
        <div className="grid grid-cols-3 gap-2 lg:hidden">
          <SummaryTile label="출발 전" value={stats.upcoming} tone="primary" />
          <SummaryTile label="진행 중" value={stats.ongoing} tone="neutral" />
          <SummaryTile label="다녀옴" value={stats.done} tone="success" />
        </div>
        <div className="mb-4 hidden grid-cols-4 gap-3 lg:grid">
          <SummaryTile label="전체" value={trips.length} tone="neutral" />
          <SummaryTile label="출발 전" value={stats.upcoming} tone="primary" />
          <SummaryTile label="진행 중" value={stats.ongoing} tone="neutral" />
          <SummaryTile label="다녀옴" value={stats.done} tone="success" />
        </div>

        <div className="mt-3 lg:mt-0">
          <FilterBar value={filter} onChange={setFilter} />
        </div>

        {loadError ? (
          <div className="mt-4 rounded-[16px] border border-[#FECDD3] bg-[#FFECEE] p-4 text-[14px] text-[#F04452]">
            {loadError}
          </div>
        ) : null}

        {filtered.length === 0 && !loadError ? (
          <div className="mt-6">
            <EmptyState />
          </div>
        ) : null}

        <div className="mt-4 space-y-3 lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0 xl:grid-cols-3">
          {filtered.map((trip) => (
            <TripSummaryCard key={trip.id} trip={trip} />
          ))}
        </div>
      </PageContainer>
    </AppFrame>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'neutral' | 'primary' | 'success';
}) {
  const valueClass =
    tone === 'primary'
      ? 'text-[#1B64DA]'
      : tone === 'success'
        ? 'text-[#00A86B]'
        : 'text-[#191F28]';
  return (
    <div className="rounded-[14px] border border-[#E5E8EB] bg-white px-3 py-3 text-center">
      <div className="text-[11px] font-semibold text-[#8B95A1]">{label}</div>
      <div className={`mt-1 text-[18px] font-bold ${valueClass}`}>{value}</div>
    </div>
  );
}

function FilterBar({ value, onChange }: { value: Filter; onChange: (next: Filter) => void }) {
  return (
    <div className="flex flex-wrap gap-2 px-4 pb-2 lg:px-0">
      {FILTERS.map((f) => {
        const active = f.value === value;
        return (
          <button
            key={f.value}
            type="button"
            onClick={() => onChange(f.value)}
            className={`min-h-9 rounded-full border px-3 py-1.5 text-[13px] font-semibold transition ${
              active
                ? 'border-[#3182F6] bg-[#EAF2FF] text-[#1B64DA]'
                : 'border-[#E5E8EB] bg-white text-[#6B7684] hover:bg-[#FAFBFC]'
            }`}
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-[16px] border border-[#E5E8EB] bg-[#FAFBFC] p-6 text-center">
      <div className="text-[24px]">🧳</div>
      <div className="mt-2 text-[14px] font-bold text-[#191F28]">해당 상태의 여행이 없어요</div>
      <div className="mt-1 text-[13px] text-[#6B7684]">
        다른 필터를 선택하거나 새 여행을 만들어보세요.
      </div>
      <div className="mt-3 flex justify-center">
        <Link
          href="/trips/new"
          className="inline-flex h-9 items-center rounded-full bg-[#3182F6] px-4 text-[13px] font-semibold text-white hover:bg-[#1B64DA]"
        >
          새 여행 만들기
        </Link>
      </div>
    </div>
  );
}
