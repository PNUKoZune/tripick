'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { DayPicker, type DateRange } from 'react-day-picker';
import { ko } from 'react-day-picker/locale';
import { format } from 'date-fns';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  PlannerMemberDto,
  ReplanBudget,
  ReplanPace,
  ReplanPlaceDto,
} from '@tripick/types';

import { SessionGuard } from '@/entities/session';
import { createTrip } from '@/entities/trip-plan';
import { DestinationSearchInput, DestinationMapPicker } from '@/features/destination-search';
import { queryKeys } from '@/shared/api/query-keys';
import { Button, PlaceSearchPicker, SegmentToggle } from '@/shared/ui';
import { AppFrame } from '@/shared/ui/app-frame';

import { FriendMemberPicker } from './friend-member-picker';
import { TimeField } from './time-field';

import 'react-day-picker/style.css';
import './trip-create-calendar.css';

type DraftMember = PlannerMemberDto;
type TransportMode = 'transit' | 'car';

const PACE_OPTIONS: Array<{ value: ReplanPace; label: string }> = [
  { value: 'relaxed', label: '여유롭게' },
  { value: 'balanced', label: '균형' },
  { value: 'packed', label: '알차게' },
];

const BUDGET_OPTIONS: Array<{ value: ReplanBudget; label: string }> = [
  { value: 'thrifty', label: '알뜰' },
  { value: 'normal', label: '보통' },
  { value: 'premium', label: '프리미엄' },
];

const TRANSPORT_OPTIONS: Array<{ value: TransportMode; label: string }> = [
  { value: 'transit', label: '대중교통' },
  { value: 'car', label: '자가용' },
];

function toIsoDate(date: Date) {
  return format(date, 'yyyy-MM-dd');
}

export function TripCreateView({ initialDestination }: { initialDestination?: string } = {}) {
  return (
    <SessionGuard>
      <TripCreateContent {...(initialDestination ? { initialDestination } : {})} />
    </SessionGuard>
  );
}

function TripCreateContent({ initialDestination }: { initialDestination?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const seedDestination = initialDestination?.trim() ?? '';
  const [title, setTitle] = useState(seedDestination ? `${seedDestination} 여행` : '');
  const [destination, setDestination] = useState(seedDestination);
  const [range, setRange] = useState<DateRange | undefined>(undefined);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('18:00');
  const [members, setMembers] = useState<DraftMember[]>([
    { id: 'me', initial: '나', color: '#3182F6' },
  ]);
  const [mustPlaces, setMustPlaces] = useState<ReplanPlaceDto[]>([]);
  const [pace, setPace] = useState<ReplanPace>('balanced');
  const [budget, setBudget] = useState<ReplanBudget>('normal');
  const [transportMode, setTransportMode] = useState<TransportMode | ''>('');
  const [notes, setNotes] = useState('');

  const NOTES_MAX = 200;

  const { mutate, isPending, error } = useMutation({
    mutationFn: createTrip,
    onSuccess: async (trip) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.planner.trips });
      router.push(`/planner?tripId=${trip.id}`);
    },
  });

  const errorMessage = error instanceof Error ? error.message : null;

  const startDate = range?.from ? toIsoDate(range.from) : '';
  const endDate = range?.to ? toIsoDate(range.to) : range?.from ? toIsoDate(range.from) : '';

  const sameDay = !!range?.from && !!range?.to && startDate === endDate;
  const timeError =
    sameDay && startTime >= endTime ? '도착 시각은 출발 시각보다 늦어야 해요.' : null;

  const canSubmit = useMemo(() => {
    return (
      title.trim().length > 0 &&
      destination.trim().length > 0 &&
      startDate.length > 0 &&
      endDate.length > 0 &&
      !timeError
    );
  }, [title, destination, startDate, endDate, timeError]);

  function addMember(member: DraftMember) {
    setMembers((prev) => (prev.some((m) => m.id === member.id) ? prev : [...prev, member]));
  }

  function removeMember(id: string) {
    setMembers((prev) => prev.filter((m) => m.id !== id));
  }

  function handleSubmit() {
    if (!canSubmit || isPending) return;
    const trimmedNotes = notes.trim();
    mutate({
      title: title.trim(),
      destination: destination.trim(),
      startDate,
      endDate,
      startTime,
      endTime,
      members,
      pace,
      budget,
      ...(transportMode ? { transportMode } : {}),
      ...(mustPlaces.length > 0 ? { mustIncludePlaces: mustPlaces } : {}),
      ...(trimmedNotes ? { notes: trimmedNotes } : {}),
    });
  }

  const rangeLabel = (() => {
    if (!range?.from) return '여행 기간을 선택해주세요';
    const fromLabel = format(range.from, 'M월 d일 (E)', { locale: ko });
    if (!range.to || toIsoDate(range.from) === toIsoDate(range.to)) {
      return `${fromLabel} · 당일치기`;
    }
    const toLabel = format(range.to, 'M월 d일 (E)', { locale: ko });
    const nights = Math.round((range.to.getTime() - range.from.getTime()) / (1000 * 60 * 60 * 24));
    return `${fromLabel} ~ ${toLabel} · ${nights}박 ${nights + 1}일`;
  })();

  const formBody = (
    <div className="space-y-6">
      <Field label="여행 제목" hint="예) 경주 1박 2일 · 친구들과 봄나들이">
        <input
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="여행 이름을 입력해주세요"
          maxLength={40}
          className="h-12 w-full rounded-[14px] border border-[#E5E8EB] bg-white px-4 text-[15px] font-medium text-[#191F28] outline-none transition placeholder:text-[#B0B8C1] focus:border-[#3182F6] focus:ring-2 focus:ring-[#E1ECFF]"
        />
      </Field>

      <Field label="여행 지역" hint="자동완성·지도에서 선택하거나 직접 입력할 수 있어요">
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <DestinationSearchInput value={destination} onChange={setDestination} />
          </div>
          <DestinationMapPicker onSelect={setDestination} />
        </div>
      </Field>

      <Field label="여행 기간" hint="달력에서 시작일과 종료일을 차례로 눌러주세요">
        <div className="rounded-[16px] border border-[#E5E8EB] bg-white p-3">
          <div className="mb-3 rounded-[12px] bg-[#F7F8FA] px-4 py-3 text-[13px] font-semibold text-[#191F28]">
            {rangeLabel}
          </div>
          <div className="flex justify-center">
            <DayPicker
              mode="range"
              selected={range}
              onSelect={setRange}
              locale={ko}
              numberOfMonths={1}
              showOutsideDays
              weekStartsOn={0}
            />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[#E5E8EB] pt-4">
            <TimeField label="출발 시각" value={startTime} onChange={setStartTime} />
            <TimeField label="도착 시각" value={endTime} onChange={setEndTime} />
          </div>
          {timeError ? (
            <p className="mt-2 text-[12px] font-semibold text-[#F04452]">{timeError}</p>
          ) : null}
        </div>
      </Field>

      <Field label="동행자" hint="내 친구 목록에서 선택해 추가합니다">
        <FriendMemberPicker members={members} onAdd={addMember} onRemove={removeMember} />
      </Field>

      <Field label="이동 수단" hint="선택 · 미선택 시 취향 설정을 따라요">
        <SegmentToggle
          items={TRANSPORT_OPTIONS}
          value={transportMode}
          onChange={(next) => setTransportMode(next as TransportMode)}
        />
      </Field>

      <Field label="일정 강도" hint="하루 일정 밀도">
        <SegmentToggle
          items={PACE_OPTIONS}
          value={pace}
          onChange={(next) => setPace(next as ReplanPace)}
        />
      </Field>

      <Field label="예산">
        <SegmentToggle
          items={BUDGET_OPTIONS}
          value={budget}
          onChange={(next) => setBudget(next as ReplanBudget)}
        />
      </Field>

      <Field label="꼭 포함할 장소" hint="이 장소들은 반드시 일정에 넣어요">
        <PlaceSearchPicker value={mustPlaces} onChange={setMustPlaces} />
      </Field>

      <Field label="이번 여행에 반영할 사항" hint={`선택 · ${notes.length}/${NOTES_MAX}자`}>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value.slice(0, NOTES_MAX))}
          placeholder={
            '예) 유아 동반이라 동선이 짧았으면 좋겠어요\n사진 찍기 좋은 장소 위주로 부탁드려요'
          }
          rows={4}
          className="w-full resize-none rounded-[14px] border border-[#E5E8EB] bg-white px-4 py-3 text-[14px] leading-[22px] text-[#191F28] outline-none transition placeholder:text-[#B0B8C1] focus:border-[#3182F6] focus:ring-2 focus:ring-[#E1ECFF]"
        />
        <p className="mt-1.5 text-[12px] text-[#8B95A1]">
          이동 제약·동행 정보·취향 등 자유롭게 적어주세요. AI 일정 생성에 반영됩니다.
        </p>
      </Field>

      {errorMessage ? (
        <div className="rounded-[16px] border border-[#FECDD3] bg-[#FFECEE] p-4 text-[14px] text-[#F04452]">
          {errorMessage}
        </div>
      ) : null}
    </div>
  );

  return (
    <AppFrame>
      {/* 헤더: 모바일 = 뒤로 + 작은 제목 / 데스크탑 = 뒤로 + 라벨/제목 + 우측 CTA */}
      <header className="px-4 pt-5 lg:border-b lg:border-[#E5E8EB] lg:bg-white lg:px-0 lg:pt-0">
        <div className="mx-auto flex w-full max-w-[1160px] items-center justify-between gap-3 pb-3 lg:gap-6 lg:px-8 lg:py-4 xl:px-10">
          <div className="flex min-w-0 flex-1 items-center gap-2 lg:gap-3">
            <Link
              href="/trips"
              aria-label="뒤로"
              className="flex size-9 items-center justify-center rounded-full hover:bg-[#F2F4F6] lg:size-auto lg:gap-1 lg:rounded-[12px] lg:border lg:border-[#E5E8EB] lg:bg-white lg:px-3 lg:py-2 lg:text-[13px] lg:font-semibold lg:text-[#6B7684] lg:hover:bg-[#FAFBFC] lg:hover:text-[#191F28]"
            >
              <span aria-hidden className="text-[20px] text-[#191F28] lg:text-inherit">
                ‹
              </span>
              <span className="hidden lg:inline">내 여행</span>
            </Link>
            <div className="min-w-0">
              <div className="hidden text-[12px] font-semibold tracking-wide text-[#3182F6] lg:block">
                Tripick · 새 여행
              </div>
              <h1 className="text-[18px] font-bold text-[#191F28] lg:mt-0.5 lg:text-[22px] lg:leading-[30px]">
                새 여행 만들기
              </h1>
            </div>
          </div>
          {/* 데스크탑 CTA */}
          <Button
            variant="primary"
            size="md"
            className="hidden h-10 px-5 text-[14px] lg:inline-flex"
            onClick={handleSubmit}
            disabled={!canSubmit || isPending}
          >
            {isPending ? '생성 중…' : '여행 만들기'}
          </Button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1160px] px-4 pb-[184px] pt-3 lg:px-8 lg:py-8 lg:pb-8 xl:px-10">
        <div className="lg:rounded-[20px] lg:border lg:border-[#E5E8EB] lg:bg-white lg:p-8 lg:shadow-[0_8px_24px_rgba(0,0,0,0.04)]">
          {formBody}
        </div>
        {/* 데스크탑 하단 CTA + 안내 문구 */}
        <div className="mt-6 hidden items-center justify-between gap-4 lg:flex">
          <p className="text-[12px] text-[#8B95A1]">
            생성한 여행은 내 계정에 저장되고 친구 목록 기반으로 멤버를 관리합니다.
          </p>
          <Button
            variant="primary"
            size="lg"
            className="shrink-0 px-8"
            onClick={handleSubmit}
            disabled={!canSubmit || isPending}
          >
            {isPending ? '생성 중…' : '여행 만들기'}
          </Button>
        </div>
      </div>

      {/* 모바일 sticky CTA: bottom nav 바로 위 (nav 높이 = pt-1.5 6px + grid 66px + safe-area pb) */}
      <div className="fixed inset-x-0 bottom-[calc(72px+max(10px,env(safe-area-inset-bottom)))] z-20 mx-auto max-w-[430px] border-t border-[#E5E8EB] bg-white px-5 py-3 lg:hidden">
        <Button
          variant="primary"
          size="lg"
          fullWidth
          onClick={handleSubmit}
          disabled={!canSubmit || isPending}
        >
          {isPending ? '생성 중…' : '여행 만들기'}
        </Button>
      </div>
    </AppFrame>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[14px] font-bold text-[#191F28]">{label}</span>
        {hint ? <span className="text-[12px] text-[#8B95A1]">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}
