'use client';

import { useEffect, useState } from 'react';
import { LuSparkles } from 'react-icons/lu';
import type {
  ReplanBudget,
  ReplanPace,
  ReplanPlaceDto,
  ReplanPreferencesDto,
} from '@tripick/types';

import { BottomSheet, PlaceSearchPicker, SegmentToggle, Switch } from '@/shared/ui';

import { useRequestReplan, type ReplanFormPayload } from '../model/use-request-replan';

type Props = {
  tripId: string;
  open: boolean;
  onClose: () => void;
  /** 재계획 요청 전송 성공 시 호출 (토스트 등) */
  onRequested?: () => void;
  /** owner 면 즉시 재계획, 아니면 owner 승인 대기 제안으로 보낸다 */
  isOwner?: boolean;
  /** 비-owner 제안 성공 시 요약 전달(토스트용) */
  onProposed?: (summary: string) => void;
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

export function ReplanModal({
  tripId,
  open,
  onClose,
  onRequested,
  isOwner = true,
  onProposed,
}: Props) {
  const mutation = useRequestReplan(tripId, {
    isOwner,
    ...(onProposed ? { onProposed } : {}),
  });
  const [note, setNote] = useState('');
  const [mustPlaces, setMustPlaces] = useState<ReplanPlaceDto[]>([]);
  const [pace, setPace] = useState<ReplanPace>('balanced');
  const [avoid, setAvoid] = useState('');
  const [minimizeTravel, setMinimizeTravel] = useState(false);
  const [budget, setBudget] = useState<ReplanBudget>('normal');

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 모달이 열릴 때 입력 필드 초기화
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
        // owner 만 "AI가 다시 짜는 중" 토스트. 제안 모드는 훅이 onProposed 로 알린다.
        if (isOwner) onRequested?.();
        onClose();
      },
    });
  }

  return (
    <BottomSheet open={open} onClose={onClose}>
      {/* @MX:NOTE: 목업의 사유 칩·"지금 일정" 비교 블록은 새 폼 상태를 도입하므로
          의도적으로 제외한다(Out of Scope — spec.md §D, REQ-WVR-051). */}
      <div className="wvr-scope px-5 pb-6 pt-2">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-full bg-[color:var(--primary-tint)] text-[color:var(--primary)]">
            <LuSparkles className="size-4" />
          </span>
          <div>
            <h2 className="text-[18px] font-bold text-[color:var(--ink)]">AI 재계획</h2>
            <p className="text-[12px] text-[color:var(--ink-faint)]">
              {isOwner
                ? '원하는 방향을 알려주면 일정을 다시 짜드려요.'
                : '재계획 요청을 보내면 여행 관리자 승인 후 실행돼요.'}
            </p>
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
              className="w-full resize-none rounded-[14px] border border-[color:var(--line)] bg-[color:var(--card-soft)] px-3 py-2.5 text-[15px] text-[color:var(--ink)] outline-none focus:border-[color:var(--primary)] focus:bg-[color:var(--card)] focus:ring-2 focus:ring-[color:var(--ring)]"
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
              className="h-11 w-full rounded-[14px] border border-[color:var(--line)] bg-[color:var(--card-soft)] px-3 text-[15px] text-[color:var(--ink)] outline-none focus:border-[color:var(--primary)] focus:bg-[color:var(--card)] focus:ring-2 focus:ring-[color:var(--ring)]"
            />
          </Field>

          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block text-[14px] font-semibold text-[color:var(--ink)]">
                이동 동선 최소화
              </span>
              <span className="block text-[12px] text-[color:var(--ink-faint)]">
                가까운 장소끼리 묶어 이동을 줄여요
              </span>
            </span>
            <Switch
              checked={minimizeTravel}
              onChange={setMinimizeTravel}
              aria-label="이동 동선 최소화"
            />
          </label>
        </div>

        {mutation.error ? (
          <div className="mt-3 rounded-[12px] border border-[color:var(--danger-border)] bg-[color:var(--danger-tint)] px-3 py-2 text-[13px] text-[color:var(--danger)]">
            {mutation.error instanceof Error ? mutation.error.message : '요청에 실패했어요.'}
          </div>
        ) : null}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={mutation.isPending}
            className="inline-flex h-14 flex-1 items-center justify-center rounded-[18px] border border-[color:var(--line)] bg-[color:var(--card)] text-[16px] font-semibold text-[color:var(--ink)] transition-colors hover:bg-[color:var(--card-soft)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            취소
          </button>
          <button
            type="button"
            disabled={mutation.isPending}
            onClick={handleSubmit}
            className="inline-flex h-14 flex-1 items-center justify-center rounded-[18px] bg-[color:var(--btn-bg)] text-[16px] font-semibold text-[color:var(--btn-text)] shadow-[var(--shadow-btn)] transition-colors hover:bg-[color:var(--btn-bg-press)] disabled:cursor-not-allowed disabled:bg-[color:var(--line)] disabled:text-[color:var(--ink-faint)] disabled:shadow-none"
          >
            {/* 전송 중 로딩 상태 문구 — 기존 mutation.isPending "요청 중…" 유지(REQ-WVR-052) */}
            {mutation.isPending ? (
              <span className="inline-flex items-center gap-2">
                <SendingSpinner />
                요청 중…
              </span>
            ) : isOwner ? (
              'AI에게 다시 맡기기'
            ) : (
              '재계획 요청 보내기'
            )}
          </button>
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
        <span className="text-[13px] font-semibold text-[color:var(--ink-sub)]">{label}</span>
        {hint ? <span className="text-[11px] text-[color:var(--ink-faint)]">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

/** 전송 중 CTA 스피너 — 목업의 로딩 시각(spin 아이콘)만 반영, 기존 문구는 그대로 유지. */
function SendingSpinner() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="animate-spin"
    >
      <circle cx="12" cy="12" r="9" stroke="rgba(255,255,255,.32)" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
