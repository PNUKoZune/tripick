'use client';

import { useEffect } from 'react';

import { useReplanSubscription } from '../model/use-replan-subscription';

const TONE = {
  completed: {
    border: 'border-[#C7DCFF]',
    bg: 'bg-[#EAF2FF]',
    accent: 'text-[#1B64DA]',
    title: 'AI가 일정을 새로 짰어요',
  },
  failed: {
    border: 'border-[#FECDD3]',
    bg: 'bg-[#FFECEE]',
    accent: 'text-[#F04452]',
    title: '재계획에 실패했어요',
  },
  processing: {
    border: 'border-[#E5E8EB]',
    bg: 'bg-white',
    accent: 'text-[#6B7684]',
    title: 'AI가 일정을 다시 짜는 중…',
  },
} as const;

/**
 * planner 화면에 마운트해 재계획 결과를 실시간 토스트로 노출한다.
 * tripId 만 넘기면 구독·갱신·알림이 모두 처리된다.
 */
export function ReplanToast({ tripId }: { tripId: string }) {
  const { latest, dismiss } = useReplanSubscription(tripId);

  // 완료 결과는 6초 뒤 자동으로 닫는다 (실패는 사용자가 직접 닫도록 유지)
  useEffect(() => {
    if (latest?.status !== 'completed') return;
    const timer = setTimeout(dismiss, 6000);
    return () => clearTimeout(timer);
  }, [latest, dismiss]);

  if (!latest) return null;

  const tone =
    latest.status === 'completed'
      ? TONE.completed
      : latest.status === 'failed'
        ? TONE.failed
        : TONE.processing;

  return (
    <div
      className="fixed inset-x-0 bottom-[104px] z-40 flex justify-center px-4 lg:bottom-6"
      role="status"
      aria-live="polite"
    >
      <div
        className={`pointer-events-auto flex w-full max-w-[398px] items-start gap-3 rounded-[16px] border ${tone.border} ${tone.bg} px-4 py-3 shadow-[0_12px_24px_rgba(0,0,0,0.12)]`}
      >
        <div className="min-w-0 flex-1">
          <div className={`text-[14px] font-bold leading-5 ${tone.accent}`}>{tone.title}</div>
          {latest.explanation ? (
            <p className="mt-0.5 line-clamp-2 text-[13px] leading-5 text-[#4E5968]">
              {latest.explanation}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="알림 닫기"
          className="-mr-1 -mt-0.5 shrink-0 rounded-full px-2 py-1 text-[13px] font-semibold text-[#8B95A1] hover:bg-black/5"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
