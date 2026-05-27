'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { TripSummaryStatus, TripSummaryDto } from '@tripick/types';

import { getStoredSession } from '@/entities/session/model/session-storage';
import { fetchPlannerTrips, TripSummaryCard } from '@/entities/trip-plan';
import { queryKeys } from '@/shared/api/query-keys';
import { AppBottomNavigation, AppDesktopNavigation } from '@/shared/ui/app-frame';

type Filter = 'all' | TripSummaryStatus;

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'upcoming', label: '곧 출발' },
  { value: 'ongoing', label: '진행 중' },
  { value: 'draft', label: '초안' },
  { value: 'done', label: '다녀옴' },
];

export function TripsView() {
  const [filter, setFilter] = useState<Filter>('all');
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    setHasSession(Boolean(getStoredSession()));
  }, []);

  const { data: trips = [], error } = useQuery({
    queryKey: queryKeys.planner.trips,
    queryFn: fetchPlannerTrips,
    enabled: hasSession === true,
    staleTime: 5 * 60 * 1000,
  });

  const loadError = error instanceof Error ? error.message : null;

  const filtered = useMemo(() => {
    if (filter === 'all') return trips;
    return trips.filter((t) => t.status === filter);
  }, [trips, filter]);

  const stats = useMemo(() => {
    const upcoming = trips.filter((t) => t.status === 'upcoming').length;
    const draft = trips.filter((t) => t.status === 'draft').length;
    const done = trips.filter((t) => t.status === 'done').length;
    return { upcoming, draft, done };
  }, [trips]);
  const latestTrip = trips[0];

  if (hasSession === null) {
    return <TripsSessionLoading />;
  }

  if (!hasSession) {
    return (
      <div className="min-h-dvh bg-white">
        <div className="mx-auto flex min-h-dvh max-w-[430px] flex-col justify-center px-5 lg:max-w-[560px]">
          <div className="text-[13px] font-black leading-5 text-[#3182F6]">Tripick</div>
          <h1 className="mt-3 text-[30px] font-black leading-9 text-[#191F28]">
            로그인이 필요해요
          </h1>
          <p className="mt-3 text-[15px] font-bold leading-6 text-[#6B7684]">
            내 여행과 친구 목록은 계정 기준으로 저장됩니다.
          </p>
          <Link
            href="/start"
            className="mt-8 inline-flex h-14 items-center justify-center rounded-[16px] bg-[#3182F6] px-5 text-[16px] font-black text-white"
          >
            시작하기
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#F7F8FA]">
      {/* < lg : 폰 셸 */}
      <div className="mx-auto min-h-dvh max-w-[430px] bg-white pb-[88px] lg:hidden">
        <header className="flex items-end justify-between px-5 pb-4 pt-6">
          <div>
            <div className="text-[13px] font-black leading-5 text-[#3182F6]">TriPick</div>
            <h1 className="mt-2 text-[28px] font-black leading-9 text-[#191F28]">내 여행</h1>
          </div>
          <Link
            href="/trips/new"
            className="inline-flex h-10 items-center gap-1 rounded-full bg-[#3182F6] px-4 text-[13px] font-bold text-white shadow-[0_6px_16px_rgba(49,130,246,0.28)] hover:bg-[#1B64DA]"
          >
            <span aria-hidden>＋</span>
            <span>새 여행</span>
          </Link>
        </header>

        <div className="grid grid-cols-3 gap-2 px-5 pb-5">
          <SummaryTile label="곧 출발" value={stats.upcoming} tone="primary" />
          <SummaryTile label="초안" value={stats.draft} tone="neutral" />
          <SummaryTile label="다녀옴" value={stats.done} tone="success" />
        </div>

        <FilterBar value={filter} onChange={setFilter} />

        <div className="space-y-3 px-4 pb-6 pt-3">
          {loadError ? (
            <div className="rounded-[16px] border border-[#FECDD3] bg-[#FFECEE] p-4 text-[14px] text-[#F04452]">
              {loadError}
            </div>
          ) : null}
          {filtered.length === 0 && !loadError ? <EmptyState /> : null}
          {filtered.map((trip) => (
            <TripSummaryCard key={trip.id} trip={trip} />
          ))}
        </div>
      </div>
      <AppBottomNavigation className="lg:hidden" />

      {/* ≥ lg : 데스크탑 웹 레이아웃 */}
      <div className="mx-auto hidden w-full max-w-[1440px] lg:grid lg:min-h-dvh lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-6 lg:px-6">
        <AppDesktopNavigation />
        <div className="min-h-dvh border-x border-[#E5E8EB] bg-white">
          <header className="border-b border-[#E5E8EB] bg-white">
            <div className="mx-auto flex w-full max-w-[1160px] items-center justify-between gap-6 px-8 py-4 xl:px-10">
              <div>
                <div className="text-[12px] font-semibold tracking-wide text-[#3182F6]">
                  Tripick · 내 여행
                </div>
                <h1 className="mt-0.5 text-[22px] font-bold leading-[30px] text-[#191F28]">
                  내 여행
                </h1>
                <p className="mt-1 text-[13px] text-[#6B7684]">
                  지금까지 만든 여행 계획을 한 곳에서 관리하세요.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Link
                  href={latestTrip ? `/planner?tripId=${latestTrip.id}` : '/trips/new'}
                  className="rounded-[14px] border border-[#E5E8EB] bg-white px-4 py-2 text-[14px] font-semibold text-[#191F28] hover:bg-[#FAFBFC]"
                >
                  {latestTrip ? '최근 여행 일정 보기' : '첫 여행 만들기'}
                </Link>
                <Link
                  href="/trips/new"
                  className="inline-flex h-10 items-center justify-center rounded-[14px] bg-[#3182F6] px-4 text-[14px] font-semibold text-white transition hover:bg-[#1B64DA]"
                >
                  새 여행 만들기
                </Link>
              </div>
            </div>
          </header>

          <div className="mx-auto w-full max-w-[1160px] px-8 py-6 xl:px-10">
            <div className="mb-4 grid grid-cols-4 gap-3">
              <SummaryTile label="전체" value={trips.length} tone="neutral" />
              <SummaryTile label="곧 출발" value={stats.upcoming} tone="primary" />
              <SummaryTile label="초안" value={stats.draft} tone="neutral" />
              <SummaryTile label="다녀옴" value={stats.done} tone="success" />
            </div>

            <FilterBar value={filter} onChange={setFilter} />

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

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((trip) => (
                <TripSummaryCard key={trip.id} trip={trip} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TripsSessionLoading() {
  return (
    <div className="min-h-dvh bg-white">
      <div className="mx-auto flex min-h-dvh max-w-[430px] flex-col justify-center px-5 lg:max-w-[560px]">
        <div className="text-[13px] font-black leading-5 text-[#3182F6]">Tripick</div>
        <h1 className="mt-3 text-[30px] font-black leading-9 text-[#191F28]">
          내 여행 확인 중
        </h1>
      </div>
    </div>
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
