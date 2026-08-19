'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { FiSearch } from 'react-icons/fi';
import { useQuery } from '@tanstack/react-query';
import type { TripSummaryStatus, TripSummaryDto } from '@tripick/types';

import { SessionGuard } from '@/entities/session';
import { fetchPlannerTrips, TripSummaryCard } from '@/entities/trip-plan';
import { DeleteTripButton } from '@/features/delete-trip';
import { PreferenceSetupPrompt } from '@/features/prompt-preference-setup';
import { DestinationSuggestions } from '@/widgets/destination-suggestions';
import { queryKeys } from '@/shared/api/query-keys';
import { AppFrame, PageContainer, PageHeader } from '@/shared/ui/app-frame';

type Filter = 'all' | TripSummaryStatus;
type Sort = 'recent' | 'departure';

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'upcoming', label: '출발 전' },
  { value: 'ongoing', label: '진행 중' },
  { value: 'done', label: '다녀옴' },
];

const SORTS: Array<{ value: Sort; label: string }> = [
  { value: 'recent', label: '최신순' },
  { value: 'departure', label: '출발임박순' },
];

/** KST 기준 오늘 날짜 (YYYY-MM-DD) */
function kstToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
}

/** 두 YYYY-MM-DD 사이의 일수 차 (toIso - fromIso) */
function diffDays(fromIso: string, toIso: string): number {
  return Math.round(
    (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000,
  );
}

export function TripsView() {
  return (
    <SessionGuard>
      <TripsContent />
    </SessionGuard>
  );
}

function TripsContent() {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('recent');

  const {
    data: trips = [],
    error,
    isLoading,
  } = useQuery({
    queryKey: queryKeys.planner.trips,
    queryFn: fetchPlannerTrips,
    staleTime: 5 * 60 * 1000,
  });

  const loadError = error instanceof Error ? error.message : null;

  // 목록 위에 스포트라이트로 띄울 여행: 진행 중 우선, 없으면 출발이 가장 임박한 여행.
  const heroTrip = useMemo(() => {
    const ongoing = trips.find((t) => t.status === 'ongoing' && t.hasDetail);
    if (ongoing) return ongoing;
    return (
      trips
        .filter((t) => t.status === 'upcoming' && t.hasDetail)
        .sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ?? null
    );
  }, [trips]);

  const visible = useMemo(() => {
    let list = filter === 'all' ? trips : trips.filter((t) => t.status === filter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (t) => t.title.toLowerCase().includes(q) || t.destination.toLowerCase().includes(q),
      );
    }
    if (sort === 'departure') {
      list = [...list].sort((a, b) => a.startDate.localeCompare(b.startDate));
    }
    return list;
  }, [trips, filter, search, sort]);

  const stats = useMemo(() => {
    const upcoming = trips.filter((t) => t.status === 'upcoming').length;
    const ongoing = trips.filter((t) => t.status === 'ongoing').length;
    const done = trips.filter((t) => t.status === 'done').length;
    return { upcoming, ongoing, done };
  }, [trips]);
  const latestTrip = trips[0];

  return (
    <AppFrame themed>
      <PageHeader
        title="내 여행"
        label="내 여행"
        description="지금까지 만든 여행 계획을 한 곳에서 관리하세요."
        action={
          <>
            <Link
              href={latestTrip ? `/planner?tripId=${latestTrip.id}` : '/trips/new'}
              className="hidden rounded-[14px] border border-[color:var(--line,#E5E8EB)] bg-[color:var(--card,#fff)] px-4 py-2 text-[14px] font-semibold text-[color:var(--ink,#191F28)] hover:bg-[color:var(--card-soft,#FAFBFC)] lg:inline-flex"
            >
              {latestTrip ? '최근 여행 일정 보기' : '첫 여행 만들기'}
            </Link>
            <Link
              href="/trips/new"
              className="inline-flex h-10 items-center gap-1 rounded-full bg-[color:var(--blue-600,#3182F6)] px-4 text-[13px] font-bold text-white shadow-[0_6px_16px_rgba(49,130,246,0.28)] hover:bg-[color:var(--blue-700,#1B64DA)] lg:gap-0 lg:rounded-[14px] lg:px-4 lg:text-[14px] lg:font-semibold lg:shadow-none"
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
        {!isLoading && !loadError && heroTrip ? (
          <div className="mb-4">
            <HeroCard trip={heroTrip} />
          </div>
        ) : null}

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

        <div className="mt-3 space-y-3 lg:mt-0">
          {trips.length > 0 && !isLoading ? (
            <SearchSortBar search={search} onSearch={setSearch} sort={sort} onSort={setSort} />
          ) : null}
          <FilterBar value={filter} onChange={setFilter} />
        </div>

        {loadError ? (
          <div
            role="alert"
            className="mt-4 rounded-[16px] border border-[color:var(--danger-border,#FECDD3)] bg-[color:var(--danger-tint,#FFECEE)] p-4 text-[14px] text-[color:var(--danger,#F04452)]"
          >
            {loadError}
          </div>
        ) : null}

        {isLoading ? (
          <SkeletonGrid />
        ) : visible.length === 0 && !loadError ? (
          <div className="mt-6">
            <EmptyState hasTrips={trips.length > 0} />
          </div>
        ) : (
          <div className="mt-4 space-y-3 lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0 xl:grid-cols-3">
            {visible.map((trip) => (
              <TripSummaryCard
                key={trip.id}
                trip={trip}
                draftAction={
                  <DeleteTripButton tripId={trip.id} tripTitle={trip.title} variant="compact" />
                }
              />
            ))}
          </div>
        )}

        {!isLoading && !loadError ? <DestinationSuggestions /> : null}
      </PageContainer>
      <PreferenceSetupPrompt />
    </AppFrame>
  );
}

function HeroCard({ trip }: { trip: TripSummaryDto }) {
  const ongoing = trip.status === 'ongoing';
  const today = kstToday();
  const dday = diffDays(today, trip.startDate);
  const badge = ongoing
    ? `여행 중 · ${diffDays(trip.startDate, today) + 1}일차`
    : dday <= 0
      ? 'D-DAY'
      : `D-${dday}`;
  const href = ongoing ? '/trip/live' : `/planner?tripId=${trip.id}`;
  const cta = ongoing ? '여행 현황 보기' : '일정 보기';

  return (
    <Link
      href={href}
      className="relative block overflow-hidden rounded-[20px] bg-[linear-gradient(135deg,#3182F6_0%,#1B64DA_100%)] p-5 text-white shadow-[0_12px_28px_rgba(49,130,246,0.28)] transition active:scale-[0.99]"
    >
      <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-1 text-[12px] font-bold">
        {ongoing ? (
          <span className="relative flex size-2 items-center justify-center">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-white/70" />
            <span className="relative inline-flex size-1.5 rounded-full bg-white" />
          </span>
        ) : null}
        {badge}
      </span>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-white/80">{trip.destination}</div>
          <h2 className="mt-0.5 truncate text-[20px] font-bold">{trip.title}</h2>
          <div className="mt-1 text-[13px] text-white/80">{trip.durationLabel}</div>
        </div>
        <span className="shrink-0 rounded-full bg-white px-3.5 py-2 text-[13px] font-bold text-[#1B64DA]">
          {cta}
        </span>
      </div>
      <span
        className="pointer-events-none absolute -right-4 -top-6 text-[96px] opacity-15"
        aria-hidden
      >
        {trip.coverEmoji}
      </span>
    </Link>
  );
}

function SearchSortBar({
  search,
  onSearch,
  sort,
  onSort,
}: {
  search: string;
  onSearch: (next: string) => void;
  sort: Sort;
  onSort: (next: Sort) => void;
}) {
  return (
    <div className="flex items-center gap-2 px-4 lg:px-0">
      <div className="relative flex-1">
        <FiSearch
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[color:var(--ink-faint,#8B95A1)]"
        />
        <input
          type="search"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="여행·목적지 검색"
          aria-label="여행 검색"
          className="h-10 w-full rounded-full border border-[color:var(--line,#E5E8EB)] bg-[color:var(--card,#fff)] pl-9 pr-3 text-[14px] text-[color:var(--ink,#191F28)] placeholder:text-[color:var(--ink-faint,#8B95A1)] focus:border-[color:var(--blue-600,#3182F6)] focus:outline-none"
        />
      </div>
      <div className="flex shrink-0 rounded-full border border-[color:var(--line,#E5E8EB)] bg-[color:var(--card,#fff)] p-0.5">
        {SORTS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onSort(opt.value)}
            className={`h-9 rounded-full px-3 text-[13px] font-semibold transition ${
              sort === opt.value
                ? 'bg-[color:var(--blue-50,#EAF2FF)] text-[color:var(--blue-700,#1B64DA)]'
                : 'text-[color:var(--ink-sub,#6B7684)]'
            }`}
          >
            {opt.label}
          </button>
        ))}
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
      ? 'text-[color:var(--blue-700,#1B64DA)]'
      : tone === 'success'
        ? 'text-[color:var(--ok,#00A86B)]'
        : 'text-[color:var(--ink,#191F28)]';
  return (
    <div className="rounded-[14px] border border-[color:var(--line,#E5E8EB)] bg-[color:var(--card,#fff)] px-3 py-3 text-center">
      <div className="text-[11px] font-semibold text-[color:var(--ink-faint,#8B95A1)]">{label}</div>
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
                ? 'border-[color:var(--blue-600,#3182F6)] bg-[color:var(--blue-50,#EAF2FF)] text-[color:var(--blue-700,#1B64DA)]'
                : 'border-[color:var(--line,#E5E8EB)] bg-[color:var(--card,#fff)] text-[color:var(--ink-sub,#6B7684)] hover:bg-[color:var(--card-soft,#FAFBFC)]'
            }`}
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div
      aria-hidden
      className="mt-4 space-y-3 lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0 xl:grid-cols-3"
    >
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className="h-full overflow-hidden rounded-[20px] border border-[color:var(--line,#E5E8EB)] bg-[color:var(--card,#fff)]"
        >
          <div className="h-16 animate-pulse bg-[color:var(--line,#EEF1F5)]" />
          <div className="flex flex-col gap-3 p-4">
            <div className="h-3 w-16 animate-pulse rounded-full bg-[color:var(--line,#EEF1F5)]" />
            <div className="h-4 w-2/3 animate-pulse rounded-full bg-[color:var(--line,#EEF1F5)]" />
            <div className="h-3 w-full animate-pulse rounded-full bg-[color:var(--line,#EEF1F5)]" />
            <div className="mt-1 h-3 w-1/2 animate-pulse rounded-full bg-[color:var(--line,#EEF1F5)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ hasTrips }: { hasTrips: boolean }) {
  // 여행 자체가 없는 신규 사용자와, 필터 결과만 비어 있는 경우의 안내를 구분한다.
  return (
    <div className="rounded-[16px] border border-[color:var(--line,#E5E8EB)] bg-[color:var(--card-soft,#FAFBFC)] p-6 text-center">
      <div className="text-[24px]">🧳</div>
      <div className="mt-2 text-[14px] font-bold text-[color:var(--ink,#191F28)]">
        {hasTrips ? '해당 조건의 여행이 없어요' : '아직 만든 여행이 없어요'}
      </div>
      <div className="mt-1 text-[13px] text-[color:var(--ink-sub,#6B7684)]">
        {hasTrips ? '다른 필터를 선택해보세요.' : '첫 여행을 만들어 일정을 받아보세요.'}
      </div>
      {hasTrips ? null : (
        <div className="mt-3 flex justify-center">
          <Link
            href="/trips/new"
            className="inline-flex h-9 items-center rounded-full bg-[color:var(--blue-600,#3182F6)] px-4 text-[13px] font-semibold text-white hover:bg-[color:var(--blue-700,#1B64DA)]"
          >
            새 여행 만들기
          </Link>
        </div>
      )}
    </div>
  );
}
