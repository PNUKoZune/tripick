'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { TripSummaryStatus, TripSummaryDto } from '@tripick/types';

import { fetchPlannerTrips, TripSummaryCard } from '@/entities/trip-plan';
import { AppBottomNavigation } from '@/shared/ui/app-frame';
import { Button, Chip } from '@/shared/ui';

type Filter = 'all' | TripSummaryStatus;

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'upcoming', label: '곧 출발' },
  { value: 'ongoing', label: '진행 중' },
  { value: 'draft', label: '초안' },
  { value: 'done', label: '다녀옴' },
];

export function TripListPage() {
  const [trips, setTrips] = useState<TripSummaryDto[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    let cancelled = false;
    fetchPlannerTrips()
      .then((result) => {
        if (cancelled) return;
        setTrips(result);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : '여행 목록을 불러오지 못했어요.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  return (
    <div className="min-h-dvh bg-[#F7F8FA]">
      {/* < lg : 폰 셸 */}
      <div className="mx-auto min-h-dvh max-w-[430px] bg-white pb-[88px] lg:hidden">
        <header className="px-5 pb-4 pt-6">
          <div className="text-[13px] font-black leading-5 text-[#3182F6]">TriPick</div>
          <h1 className="mt-2 text-[28px] font-black leading-9 text-[#191F28]">내 여행</h1>
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
      <div className="hidden lg:grid lg:min-h-dvh lg:grid-rows-[auto_1fr]">
        <header className="border-b border-[#E5E8EB] bg-white">
          <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-6 px-8 py-4 xl:px-10">
            <div>
              <div className="text-[12px] font-semibold tracking-wide text-[#3182F6]">
                TriPick · My Trips
              </div>
              <h1 className="mt-0.5 text-[22px] font-bold leading-[30px] text-[#191F28]">
                내 여행
              </h1>
              <p className="mt-1 text-[13px] text-[#6B7684]">
                지금 까지 만든 여행 계획을 한 곳에서 관리하세요.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/planner"
                className="rounded-[14px] border border-[#E5E8EB] bg-white px-4 py-2 text-[14px] font-semibold text-[#191F28] hover:bg-[#FAFBFC]"
              >
                현재 데모 일정 보기
              </Link>
              <Button variant="primary" size="md" className="h-10 px-4 text-[14px]">
                새 여행 만들기
              </Button>
            </div>
          </div>
        </header>

        <div className="mx-auto w-full max-w-[1600px] px-8 py-6 xl:px-10">
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
    tone === 'primary' ? 'text-[#1B64DA]' : tone === 'success' ? 'text-[#00A86B]' : 'text-[#191F28]';
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
        <Chip tone="primary">새 여행 만들기 (mock)</Chip>
      </div>
    </div>
  );
}
