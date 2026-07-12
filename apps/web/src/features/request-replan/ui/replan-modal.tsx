'use client';

import { useEffect, useState } from 'react';
import { LuSparkles } from 'react-icons/lu';
import type {
  ReplanBudget,
  ReplanPace,
  ReplanPlaceDto,
  ReplanPreferencesDto,
} from '@tripick/types';

import { BottomSheet, Button, PlaceSearchPicker, SegmentToggle, Switch } from '@/shared/ui';

import { useRequestReplan, type ReplanFormPayload } from '../model/use-request-replan';

type Props = {
  tripId: string;
  open: boolean;
  onClose: () => void;
  /** 재계획 요청 전송 성공 시 호출 (토스트 등) */
  onRequested?: () => void;
};

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

export function ReplanModal({ tripId, open, onClose, onRequested }: Props) {
  const mutation = useRequestReplan(tripId);
  const [note, setNote] = useState('');
  const [mustPlaces, setMustPlaces] = useState<ReplanPlaceDto[]>([]);
  const [pace, setPace] = useState<ReplanPace>('balanced');
  const [avoid, setAvoid] = useState('');
  const [minimizeTravel, setMinimizeTravel] = useState(false);
  const [budget, setBudget] = useState<ReplanBudget>('normal');

  useEffect(() => {
    if (!open) return;
    setNote('');
    setMustPlaces([]);
    setPace('balanced');
    setAvoid('');
    setMinimizeTravel(false);
    setBudget('normal');
    mutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleSubmit() {
    const preferences: ReplanPreferencesDto = {
      pace,
      budget,
      ...(avoid.trim() ? { avoid: avoid.trim() } : {}),
      ...(minimizeTravel ? { minimizeTravel: true } : {}),
    };
    const payload: ReplanFormPayload = {
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(mustPlaces.length > 0 ? { mustIncludePlaces: mustPlaces } : {}),
      preferences,
    };
    mutation.mutate(payload, {
      onSuccess: () => {
        onRequested?.();
        onClose();
      },
    });
  }

  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="px-5 pb-6 pt-2">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-full bg-[#EAF2FF] text-[#3182F6]">
            <LuSparkles className="size-4" />
          </span>
          <div>
            <h2 className="text-[18px] font-bold text-[#191F28]">AI 재계획</h2>
            <p className="text-[12px] text-[#8B95A1]">원하는 방향을 알려주면 일정을 다시 짜드려요.</p>
          </div>
        </div>

        <div className="mt-4 space-y-5">
          <Field label="어떻게 바꿀까요?" hint="자유롭게 적어주세요">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="예) 카페는 1곳만 가고 싶어요. 둘째 날은 바다 위주로 해주세요."
              maxLength={300}
              rows={3}
              className="w-full resize-none rounded-[12px] border border-[#E5E8EB] bg-white px-3 py-2 text-[14px] text-[#191F28] outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#E1ECFF]"
            />
          </Field>

          <Field label="꼭 포함할 장소" hint="이 장소들은 반드시 일정에 넣어요">
            <PlaceSearchPicker value={mustPlaces} onChange={setMustPlaces} />
          </Field>

          <Field label="일정 강도">
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

          <Field label="피하고 싶은 것">
            <input
              type="text"
              value={avoid}
              onChange={(e) => setAvoid(e.target.value)}
              placeholder="예) 대기 긴 맛집, 계단 많은 곳"
              maxLength={200}
              className="h-11 w-full rounded-[12px] border border-[#E5E8EB] bg-white px-3 text-[15px] text-[#191F28] outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#E1ECFF]"
            />
          </Field>

          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block text-[14px] font-semibold text-[#191F28]">이동 동선 최소화</span>
              <span className="block text-[12px] text-[#8B95A1]">가까운 장소끼리 묶어 이동을 줄여요</span>
            </span>
            <Switch
              checked={minimizeTravel}
              onChange={setMinimizeTravel}
              aria-label="이동 동선 최소화"
            />
          </label>
        </div>

        {mutation.error ? (
          <div className="mt-3 rounded-[12px] border border-[#FECDD3] bg-[#FFECEE] px-3 py-2 text-[13px] text-[#F04452]">
            {mutation.error instanceof Error ? mutation.error.message : '요청에 실패했어요.'}
          </div>
        ) : null}

        <div className="mt-5 flex gap-2">
          <Button
            variant="secondary"
            size="lg"
            className="flex-1"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            취소
          </Button>
          <Button
            variant="primary"
            size="lg"
            className="flex-1"
            disabled={mutation.isPending}
            onClick={handleSubmit}
          >
            {mutation.isPending ? '요청 중…' : 'AI에게 다시 맡기기'}
          </Button>
        </div>
      </div>
    </BottomSheet>
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
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="text-[13px] font-semibold text-[#4E5968]">{label}</span>
        {hint ? <span className="text-[11px] text-[#B0B8C1]">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}
