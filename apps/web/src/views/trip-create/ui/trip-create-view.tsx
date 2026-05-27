'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { DayPicker, type DateRange } from 'react-day-picker';
import { ko } from 'react-day-picker/locale';
import { format } from 'date-fns';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PlannerMemberDto } from '@tripick/types';

import { createTrip } from '@/entities/trip-plan';
import { DestinationSearchInput } from '@/features/destination-search';
import { queryKeys } from '@/shared/api/query-keys';
import { Button } from '@/shared/ui';
import { AppBottomNavigation, AppDesktopNavigation } from '@/shared/ui/app-frame';

import { FriendMemberPicker } from './friend-member-picker';
import { TimeSelect } from './time-select';

import 'react-day-picker/style.css';
import './trip-create-calendar.css';

type DraftMember = PlannerMemberDto;

function toIsoDate(date: Date) {
  return format(date, 'yyyy-MM-dd');
}

export function TripCreateView() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [destination, setDestination] = useState('');
  const [range, setRange] = useState<DateRange | undefined>(undefined);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('18:00');
  const [members, setMembers] = useState<DraftMember[]>([
    { id: 'me', initial: '나', color: '#3182F6' },
  ]);
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

      <Field label="여행 지역" hint="자동완성에서 선택하거나 직접 입력할 수 있어요">
        <DestinationSearchInput value={destination} onChange={setDestination} />
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
            <TimeSelect label="출발 시각" value={startTime} onChange={setStartTime} />
            <TimeSelect label="도착 시각" value={endTime} onChange={setEndTime} />
          </div>
          {timeError ? (
            <p className="mt-2 text-[12px] font-semibold text-[#F04452]">{timeError}</p>
          ) : null}
        </div>
      </Field>

      <Field label="동행자" hint="내 친구 목록에서 선택해 추가합니다">
        <FriendMemberPicker members={members} onAdd={addMember} onRemove={removeMember} />
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
    <div className="min-h-dvh bg-[#F7F8FA]">
      {/* < lg : 폰 셸 */}
      <div className="mx-auto min-h-dvh max-w-[430px] bg-white pb-[170px] lg:hidden">
        <header className="flex items-center gap-2 px-4 pb-3 pt-5">
          <Link
            href="/trips"
            aria-label="뒤로"
            className="flex size-9 items-center justify-center rounded-full hover:bg-[#F2F4F6]"
          >
            <span className="text-[20px] text-[#191F28]" aria-hidden>
              ‹
            </span>
          </Link>
          <h1 className="text-[18px] font-bold text-[#191F28]">새 여행 만들기</h1>
        </header>
        <div className="px-5 pt-2">{formBody}</div>

        <div className="fixed inset-x-0 bottom-[66px] z-10 mx-auto max-w-[430px] border-t border-[#E5E8EB] bg-white px-5 py-3">
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
      </div>
      <AppBottomNavigation className="lg:hidden" />

      {/* ≥ lg : 데스크탑 */}
      <div className="mx-auto hidden w-full max-w-[1440px] lg:grid lg:min-h-dvh lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-6 lg:px-6">
        <AppDesktopNavigation />
        <div className="min-h-dvh border-x border-[#E5E8EB] bg-white">
          <header className="border-b border-[#E5E8EB] bg-white">
            <div className="mx-auto flex w-full max-w-[960px] items-center justify-between gap-6 px-8 py-4 xl:px-10">
              <div className="flex items-center gap-3">
                <Link
                  href="/trips"
                  className="flex h-9 items-center gap-1 rounded-[12px] border border-[#E5E8EB] bg-white px-3 text-[13px] font-semibold text-[#6B7684] hover:bg-[#FAFBFC] hover:text-[#191F28]"
                >
                  <span aria-hidden>‹</span>
                  <span>내 여행</span>
                </Link>
                <div>
                  <div className="text-[12px] font-semibold tracking-wide text-[#3182F6]">
                    Tripick · 새 여행
                  </div>
                  <h1 className="mt-0.5 text-[22px] font-bold leading-[30px] text-[#191F28]">
                    새 여행 만들기
                  </h1>
                </div>
              </div>
              <Button
                variant="primary"
                size="md"
                className="h-10 px-5 text-[14px]"
                onClick={handleSubmit}
                disabled={!canSubmit || isPending}
              >
                {isPending ? '생성 중…' : '여행 만들기'}
              </Button>
            </div>
          </header>

          <div className="mx-auto w-full max-w-[960px] px-8 py-8 xl:px-10">
            <div className="rounded-[20px] border border-[#E5E8EB] bg-white p-8 shadow-[0_8px_24px_rgba(0,0,0,0.04)]">
              {formBody}
            </div>
            <p className="mt-4 text-[12px] text-[#8B95A1]">
              · v1 데모: 생성된 여행은 서버 메모리에만 저장되며, 새로고침/재시작 시 초기화됩니다.
            </p>
          </div>
        </div>
      </div>
    </div>
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
