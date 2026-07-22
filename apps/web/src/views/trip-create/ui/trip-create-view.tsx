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
import { Button, PlaceSearchPicker, SegmentToggle, TimeField } from '@/shared/ui';
import { AppFrame } from '@/shared/ui/app-frame';

import { FriendMemberPicker } from './friend-member-picker';
import { TripCreateLoading } from './trip-create-loading';

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
    { id: 'me', initial: '나', color: 'var(--primary)' },
  ]);
  const [mustPlaces, setMustPlaces] = useState<ReplanPlaceDto[]>([]);
  const [pace, setPace] = useState<ReplanPace>('balanced');
  const [budget, setBudget] = useState<ReplanBudget>('normal');
  const [transportMode, setTransportMode] = useState<TransportMode | ''>('');
  const [notes, setNotes] = useState('');
  const [navigating, setNavigating] = useState(false);

  const NOTES_MAX = 200;

  const { mutate, isPending, error } = useMutation({
    mutationFn: createTrip,
    onSuccess: async (trip) => {
      // 생성 성공 후 /planner 이동이 끝날 때까지 로딩 화면을 유지 (isPending 이 내려가며 생기는 깜빡임 방지)
      setNavigating(true);
      await queryClient.invalidateQueries({ queryKey: queryKeys.planner.trips });
      router.push(`/planner?tripId=${trip.id}`);
    },
  });

  const showLoading = isPending || navigating;

  const errorMessage = error instanceof Error ? error.message : null;

  const today = useMemo(() => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  }, []);

  const startDate = range?.from ? toIsoDate(range.from) : '';
  const endDate = range?.to ? toIsoDate(range.to) : range?.from ? toIsoDate(range.from) : '';

  // 당일치기는 달력을 한 번만 클릭해 range.to 가 없으므로 날짜 문자열로 판정한다.
  const sameDay = startDate.length > 0 && startDate === endDate;
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
    if (!canSubmit || showLoading) return;
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
    <div className="rounded-[22px] border border-[color:var(--line)] bg-[color:var(--card)] px-5 pb-6 pt-1 shadow-[var(--shadow-card)]">
      {/* 01 어디로, 언제 — 기존 3개 필드(여행 제목·지역·기간) 그대로, mega-card 시각만 재스타일 */}
      <Group index="01" label="어디로, 언제">
        <Field label="여행 제목" hint="예) 경주 1박 2일 · 친구들과 봄나들이">
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="여행 이름을 입력해주세요"
            maxLength={40}
            className="h-14 w-full rounded-[14px] border border-[color:var(--line)] bg-[color:var(--card-soft)] px-4 text-[15px] font-medium text-[color:var(--ink)] outline-none transition placeholder:text-[color:var(--ink-faint)] focus:border-[color:var(--primary)] focus:bg-[color:var(--card)] focus:ring-2 focus:ring-[color:var(--ring)]"
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
          <div className="rounded-[16px] border border-[color:var(--line)] bg-[color:var(--card-soft)] p-3">
            <div className="mb-3 rounded-[12px] bg-[color:var(--primary-tint)] px-4 py-3 text-[13px] font-semibold text-[color:var(--primary-deep)]">
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
                disabled={{ before: today }}
                startMonth={today}
              />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[color:var(--line)] pt-4">
              <TimeField label="출발 시각" value={startTime} onChange={setStartTime} />
              <TimeField label="도착 시각" value={endTime} onChange={setEndTime} />
            </div>
            {timeError ? (
              <p className="mt-2 text-[12px] font-semibold text-[color:var(--danger)]">{timeError}</p>
            ) : null}
          </div>
        </Field>
      </Group>

      {/* 02 누구와, 어떻게 — 기존 2개 필드(동행자·이동 수단) 그대로 */}
      <Group index="02" label="누구와, 어떻게">
        <Field label="동행자" hint="내 친구 목록에서 선택해 추가합니다">
          <FriendMemberPicker members={members} onAdd={addMember} onRemove={removeMember} />
        </Field>

        <Field label="이동 수단" hint="선택 · 다시 누르면 해제(취향 설정을 따라요)">
          <SegmentToggle
            items={TRANSPORT_OPTIONS}
            value={transportMode}
            onChange={(next) =>
              setTransportMode((prev) => (prev === next ? '' : (next as TransportMode)))
            }
          />
        </Field>
      </Group>

      {/* 03 예산과 리듬 — 기존 2개 필드(일정 강도·예산) 그대로 */}
      <Group index="03" label="예산과 리듬">
        <Field label="일정 강도" hint="하루 일정 밀도">
          <SegmentToggle
            items={PACE_OPTIONS}
            value={pace}
            onChange={(next) => setPace(next as ReplanPace)}
            columns={3}
          />
        </Field>

        <Field label="예산">
          <SegmentToggle
            items={BUDGET_OPTIONS}
            value={budget}
            onChange={(next) => setBudget(next as ReplanBudget)}
            columns={3}
          />
        </Field>
      </Group>

      {/* 04 더 반영하고 싶은 것 — 기존 2개 필드(꼭 포함할 장소·반영할 사항) 그대로 */}
      <Group index="04" label="더 반영하고 싶은 것">
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
            className="w-full resize-none rounded-[14px] border border-[color:var(--line)] bg-[color:var(--card-soft)] px-4 py-3 text-[14px] leading-[22px] text-[color:var(--ink)] outline-none transition placeholder:text-[color:var(--ink-faint)] focus:border-[color:var(--primary)] focus:bg-[color:var(--card)] focus:ring-2 focus:ring-[color:var(--ring)]"
          />
          <p className="mt-1.5 text-[12px] text-[color:var(--ink-faint)]">
            이동 제약·동행 정보·취향 등 자유롭게 적어주세요. AI 일정 생성에 반영됩니다.
          </p>
        </Field>
      </Group>

      {errorMessage ? (
        <div className="mt-6 rounded-[16px] border border-[color:var(--danger-border)] bg-[color:var(--danger-tint)] p-4 text-[14px] text-[color:var(--danger)]">
          {errorMessage}
        </div>
      ) : null}
    </div>
  );

  // Toss식 disabled CTA — 여행 지역이 비었을 때만 비활성 사유를 알려준다(REQ-WVR-032, GWT-4).
  const destinationMissing = destination.trim().length === 0;
  const ctaHelper = !canSubmit && destinationMissing ? '여행 지역을 입력하면 여행을 만들 수 있어요' : null;

  return (
    <AppFrame>
      <div className="wvr-scope">
        {/* 헤더: 모바일 = 뒤로 + 작은 제목 / 데스크탑 = 뒤로 + 라벨/제목 + 우측 CTA */}
        <header className="px-4 pt-5 lg:border-b lg:border-[color:var(--line)] lg:bg-[color:var(--card)] lg:px-0 lg:pt-0">
          <div className="mx-auto flex w-full max-w-[1160px] items-center justify-between gap-3 pb-3 lg:gap-6 lg:px-8 lg:py-4 xl:px-10">
            <div className="flex min-w-0 flex-1 items-center gap-2 lg:gap-3">
              <Link
                href="/trips"
                aria-label="뒤로"
                className="flex size-9 items-center justify-center rounded-full hover:bg-[color:var(--card-soft)] lg:size-auto lg:gap-1 lg:rounded-[12px] lg:border lg:border-[color:var(--line)] lg:bg-[color:var(--card)] lg:px-3 lg:py-2 lg:text-[13px] lg:font-semibold lg:text-[color:var(--ink-sub)] lg:hover:bg-[color:var(--card-soft)] lg:hover:text-[color:var(--ink)]"
              >
                <span aria-hidden className="text-[20px] text-[color:var(--ink)] lg:text-inherit">
                  ‹
                </span>
                <span className="hidden lg:inline">내 여행</span>
              </Link>
              <div className="min-w-0">
                <div className="hidden text-[12px] font-semibold tracking-wide text-[color:var(--primary)] lg:block">
                  Tripick · 새 여행
                </div>
                <h1 className="text-[18px] font-bold text-[color:var(--ink)] lg:mt-0.5 lg:text-[22px] lg:leading-[30px]">
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
              disabled={!canSubmit || showLoading}
            >
              {showLoading ? '생성 중…' : '여행 만들기'}
            </Button>
          </div>
        </header>

        <div className="mx-auto w-full max-w-[1160px] px-4 pb-[184px] pt-3 lg:px-8 lg:py-8 lg:pb-8 xl:px-10">
          {formBody}
          {/* 데스크탑 하단 CTA + 안내 문구 */}
          <div className="mt-6 hidden items-center justify-between gap-4 lg:flex">
            <p className="text-[12px] text-[color:var(--ink-faint)]">
              {ctaHelper ?? '생성한 여행은 내 계정에 저장되고 친구 목록 기반으로 멤버를 관리합니다.'}
            </p>
            <Button
              variant="primary"
              size="lg"
              className="shrink-0 px-8"
              onClick={handleSubmit}
              disabled={!canSubmit || showLoading}
            >
              {showLoading ? '생성 중…' : '여행 만들기'}
            </Button>
          </div>
        </div>

        {/* 모바일 sticky CTA: bottom nav 바로 위 (nav 높이 = pt-1.5 6px + grid 66px + safe-area pb) */}
        <div className="fixed inset-x-0 bottom-[calc(72px+max(10px,env(safe-area-inset-bottom)))] z-20 mx-auto max-w-[430px] border-t border-[color:var(--line)] bg-[color:var(--card)] px-5 py-3 lg:hidden">
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={handleSubmit}
            disabled={!canSubmit || showLoading}
          >
            {showLoading ? '생성 중…' : '여행 만들기'}
          </Button>
          {ctaHelper ? (
            <p className="mt-2 text-center text-[12.5px] text-[color:var(--ink-faint)]">{ctaHelper}</p>
          ) : null}
        </div>

        {showLoading ? <TripCreateLoading /> : null}
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
        <span className="text-[14px] font-bold text-[color:var(--ink)]">{label}</span>
        {hint ? <span className="text-[12px] text-[color:var(--ink-faint)]">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

/** mega-card 그룹 — 목업의 점선 구분 + "01 캡션" 라벨(REQ-WVR-030). */
function Group({
  index,
  label,
  children,
}: {
  index: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-dashed border-[color:var(--line)] pt-[22px] first:border-t-0 first:pt-4">
      <p className="mb-4 text-[12.5px] font-bold tracking-[0.02em] text-[color:var(--ink-faint)]">
        <span className="mr-[7px] font-mono text-[11px] text-[color:var(--primary)]">{index}</span>
        {label}
      </p>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
