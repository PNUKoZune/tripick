'use client';

import { useEffect, useState } from 'react';
import { FiAlertTriangle, FiArrowLeft } from 'react-icons/fi';

import {
  WITHDRAWAL_CONFIRM_PHRASE,
  WITHDRAWAL_REASONS,
  type WithdrawUserDto,
  type WithdrawalReasonCode,
} from '@/entities/user';

type Props = {
  pending: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (dto: WithdrawUserDto) => void;
};

const DETAIL_MAX_LENGTH = 500;

/** 탈퇴가 지우는 것들. 확인 단계에서 그대로 보여준다. */
const LOSS_ITEMS = [
  '여행 일정과 지도에 저장한 장소',
  '사진으로 학습한 취향 태그와 추천 기록',
  '친구 목록, 함께하는 여행의 멤버 자격',
  '받은 알림과 인박스 내역',
];

/**
 * 2단계 탈퇴 플로우. ① 사유 수집(건너뛰기 가능) → ② 삭제 범위 고지 + 확인 문구 입력.
 * 계정은 유예 없이 즉시 물리 삭제되므로, 실수로 누른 탈퇴를 확인 문구가 마지막으로 막는다.
 */
export function WithdrawalDialog({ pending, error, onClose, onSubmit }: Props) {
  const [step, setStep] = useState<'reason' | 'confirm'>('reason');
  const [reason, setReason] = useState<WithdrawalReasonCode | null>(null);
  const [detail, setDetail] = useState('');
  const [confirmation, setConfirmation] = useState('');

  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = original;
      window.removeEventListener('keydown', onKey);
    };
  }, [pending, onClose]);

  const submit = () => {
    const dto: WithdrawUserDto = { confirmation: confirmation.trim() };
    if (reason) dto.reason = reason;
    if (detail.trim()) dto.reasonDetail = detail.trim();
    onSubmit(dto);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-5"
      role="dialog"
      aria-modal="true"
      aria-label="회원 탈퇴"
    >
      <button
        type="button"
        aria-label="닫기"
        onClick={() => {
          if (!pending) onClose();
        }}
        className="absolute inset-0 bg-black/45"
      />
      <div className="relative flex max-h-[86vh] w-full max-w-[400px] flex-col overflow-hidden rounded-[20px] bg-[color:var(--card,#FFFFFF)] p-5 shadow-[0_24px_60px_rgba(15,23,42,0.22)]">
        {step === 'reason' ? (
          <ReasonStep
            reason={reason}
            detail={detail}
            onReasonChange={setReason}
            onDetailChange={setDetail}
            onCancel={onClose}
            onNext={() => setStep('confirm')}
          />
        ) : (
          <ConfirmStep
            confirmation={confirmation}
            pending={pending}
            error={error ?? null}
            onConfirmationChange={setConfirmation}
            onBack={() => setStep('reason')}
            onSubmit={submit}
          />
        )}
      </div>
    </div>
  );
}

function ReasonStep({
  reason,
  detail,
  onReasonChange,
  onDetailChange,
  onCancel,
  onNext,
}: {
  reason: WithdrawalReasonCode | null;
  detail: string;
  onReasonChange: (value: WithdrawalReasonCode) => void;
  onDetailChange: (value: string) => void;
  onCancel: () => void;
  onNext: () => void;
}) {
  return (
    <>
      <h2 className="shrink-0 text-[18px] font-bold text-[color:var(--ink,#191F28)]">
        떠나시는 이유를 알려주세요
      </h2>
      <p className="mt-2 shrink-0 text-[13px] leading-[20px] text-[color:var(--ink-sub,#4E5968)]">
        답변은 익명으로 저장되고 서비스 개선에만 씁니다. 건너뛰어도 괜찮아요.
      </p>

      {/* 목록만 스크롤시키고 자유입력·버튼은 아래 고정 — 입력란이 스크롤 영역에 잘려 보이지 않도록 */}
      <div className="mt-4 flex min-h-[96px] flex-1 flex-col gap-2 overflow-y-auto">
        {WITHDRAWAL_REASONS.map(({ code, label }) => (
          <label
            key={code}
            className={`flex shrink-0 cursor-pointer items-center gap-3 rounded-[12px] border px-4 py-3 text-[14px] leading-[20px] transition focus-within:ring-2 focus-within:ring-[color:var(--blue-600,#3182F6)] ${
              reason === code
                ? 'border-[color:var(--blue-600,#3182F6)] bg-[color:var(--blue-50,#EEF6FF)] font-bold text-[color:var(--ink,#191F28)]'
                : 'border-[color:var(--line,#E5E8EB)] text-[color:var(--ink-sub,#4E5968)] hover:bg-[color:var(--card-soft,#FAFBFC)]'
            }`}
          >
            {/* globals.css 의 `input { appearance: none }` 때문에 네이티브 radio 가 안 보여서 직접 그린다 */}
            <input
              type="radio"
              name="withdrawal-reason"
              value={code}
              checked={reason === code}
              onChange={() => onReasonChange(code)}
              className="sr-only"
            />
            <span
              aria-hidden
              className={`flex size-[18px] shrink-0 items-center justify-center rounded-full border-2 transition ${
                reason === code
                  ? 'border-[color:var(--blue-600,#3182F6)]'
                  : 'border-[color:var(--line,#D1D6DB)]'
              }`}
            >
              {reason === code ? (
                <span className="size-[9px] rounded-full bg-[color:var(--blue-600,#3182F6)]" />
              ) : null}
            </span>
            {label}
          </label>
        ))}
      </div>

      <textarea
        value={detail}
        onChange={(event) => onDetailChange(event.target.value.slice(0, DETAIL_MAX_LENGTH))}
        rows={2}
        placeholder="더 하고 싶은 말이 있다면 자유롭게 남겨주세요 (선택)"
        className="mt-3 w-full shrink-0 resize-none rounded-[12px] border border-[color:var(--line,#E5E8EB)] bg-[color:var(--card,#FFFFFF)] px-4 py-3 text-[14px] leading-[20px] text-[color:var(--ink,#191F28)] outline-none placeholder:text-[color:var(--ink-faint,#8B95A1)] focus:border-[color:var(--blue-600,#3182F6)]"
      />
      <span className="mt-1 shrink-0 text-right text-[12px] text-[color:var(--ink-faint,#8B95A1)]">
        {detail.length}/{DETAIL_MAX_LENGTH}
      </span>

      <div className="mt-3 flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-11 flex-1 rounded-[12px] border border-[color:var(--line,#E5E8EB)] bg-[color:var(--card,#FFFFFF)] text-[14px] font-bold text-[color:var(--ink-sub,#6B7684)] hover:bg-[color:var(--card-soft,#FAFBFC)]"
        >
          그만두기
        </button>
        <button
          type="button"
          onClick={onNext}
          className="h-11 flex-1 rounded-[12px] bg-[color:var(--ink,#191F28)] text-[14px] font-bold text-[color:var(--btn-text,#FFFFFF)] hover:brightness-110"
        >
          {reason || detail.trim() ? '다음' : '건너뛰고 계속'}
        </button>
      </div>
    </>
  );
}

function ConfirmStep({
  confirmation,
  pending,
  error,
  onConfirmationChange,
  onBack,
  onSubmit,
}: {
  confirmation: string;
  pending: boolean;
  error: string | null;
  onConfirmationChange: (value: string) => void;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const matched = confirmation.trim() === WITHDRAWAL_CONFIRM_PHRASE;

  return (
    <>
      <button
        type="button"
        onClick={onBack}
        disabled={pending}
        className="mb-3 flex shrink-0 items-center gap-1 text-[13px] font-semibold text-[color:var(--ink-sub,#6B7684)] disabled:opacity-50"
      >
        <FiArrowLeft className="size-4" aria-hidden />
        이전
      </button>

      <h2 className="flex shrink-0 items-center gap-2 text-[18px] font-bold text-[color:var(--danger,#F04452)]">
        <FiAlertTriangle className="size-5" aria-hidden />
        탈퇴하면 되돌릴 수 없어요
      </h2>

      {/* 고지 문구만 스크롤 — 확인 입력란과 탈퇴 버튼은 항상 보이게 */}
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
        <p className="text-[13px] leading-[20px] text-[color:var(--ink-sub,#4E5968)]">
          아래 데이터가 유예 기간 없이 즉시 삭제됩니다. 같은 계정으로 다시 가입해도 복구되지 않아요.
        </p>

        <ul className="mt-3 flex flex-col gap-1.5 rounded-[12px] bg-[color:var(--danger-tint,#FFECEE)] px-4 py-3">
          {LOSS_ITEMS.map((item) => (
            <li
              key={item}
              className="flex gap-2 text-[13px] leading-[20px] text-[color:var(--ink-sub,#4E5968)]"
            >
              <span aria-hidden>·</span>
              {item}
            </li>
          ))}
        </ul>
      </div>

      <label className="mt-4 block shrink-0 text-[13px] font-bold text-[color:var(--ink,#191F28)]">
        계속하려면 <span className="text-[color:var(--danger,#F04452)]">{WITHDRAWAL_CONFIRM_PHRASE}</span>
        를 입력해주세요
      </label>
      <input
        value={confirmation}
        onChange={(event) => onConfirmationChange(event.target.value)}
        disabled={pending}
        autoComplete="off"
        placeholder={WITHDRAWAL_CONFIRM_PHRASE}
        className="mt-2 h-12 w-full shrink-0 rounded-[12px] border border-[color:var(--line,#E5E8EB)] bg-[color:var(--card,#FFFFFF)] px-4 text-[15px] text-[color:var(--ink,#191F28)] outline-none placeholder:text-[color:var(--ink-faint,#8B95A1)] focus:border-[color:var(--danger,#F04452)] disabled:opacity-50"
      />
      {error ? (
        <p className="mt-2 text-[13px] leading-[20px] text-[color:var(--danger,#F04452)]">{error}</p>
      ) : null}

      <button
        type="button"
        onClick={onSubmit}
        disabled={!matched || pending}
        className="mt-4 h-12 w-full shrink-0 rounded-[12px] bg-[color:var(--danger,#F04452)] text-[15px] font-bold text-[color:var(--btn-text,#FFFFFF)] hover:brightness-95 disabled:opacity-40"
      >
        {pending ? '탈퇴 처리 중…' : '영구 탈퇴하기'}
      </button>
    </>
  );
}
