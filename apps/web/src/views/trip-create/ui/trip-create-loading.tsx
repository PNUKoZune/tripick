'use client';

import Link from 'next/link';
import { LuCheck, LuCircleAlert, LuPlane, LuRotateCcw } from 'react-icons/lu';
import type { TripGenerationJobDto, TripGenerationStage } from '@tripick/types';

const STEPS: Array<{ stage: TripGenerationStage; label: string }> = [
  { stage: 'queued', label: '생성 작업을 준비하는 중' },
  { stage: 'discovering_places', label: '취향에 맞는 장소를 찾는 중' },
  { stage: 'building_itinerary', label: '이동 동선과 일정표를 만드는 중' },
  { stage: 'saving', label: '완성된 일정을 저장하는 중' },
];

const STAGE_INDEX: Record<TripGenerationStage, number> = {
  queued: 0,
  preparing: 0,
  discovering_places: 1,
  building_itinerary: 2,
  saving: 3,
  completed: 4,
};

interface Props {
  job: TripGenerationJobDto | undefined;
  loadingStatus: boolean;
  connectionError: string | null;
  retrying: boolean;
  retryError: string | null;
  onRetry: () => void;
  onRefresh: () => void;
}

/** BullMQ Worker가 보고한 실제 단계와 재시도 상태를 표시하는 풀스크린 생성 화면. */
export function TripCreateLoading({
  job,
  loadingStatus,
  connectionError,
  retrying,
  retryError,
  onRetry,
  onRefresh,
}: Props) {
  const failed = job?.status === 'failed';
  const unavailable = job?.status === 'unavailable' || Boolean(connectionError);
  const currentIndex = STAGE_INDEX[job?.stage ?? 'queued'];
  const progress = job?.progress ?? 5;
  const retryLabel =
    job?.status === 'retrying'
      ? `일시적인 오류로 자동 재시도 중 (${job.attempt}/${job.maxAttempts})`
      : null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-[color:var(--card,#fff)] px-8">
      <div className="relative flex size-16 items-center justify-center">
        {failed || unavailable ? (
          <LuCircleAlert className="size-10 text-[color:var(--danger,#F04452)]" aria-hidden />
        ) : (
          <>
            <span className="absolute inset-0 motion-safe:animate-spin rounded-full border-[3px] border-[color:var(--line,#E5E8EB)] border-t-[color:var(--primary,#3182F6)]" />
            <LuPlane className="size-6 text-[color:var(--primary,#3182F6)]" aria-hidden />
          </>
        )}
      </div>

      <div className="text-center">
        <p className="text-[17px] font-bold text-[color:var(--ink,#191F28)]">
          {failed
            ? '일정을 완성하지 못했어요'
            : unavailable
              ? '생성 상태를 확인하지 못했어요'
              : 'AI가 여행을 만들고 있어요'}
        </p>
        <p className="mt-1.5 max-w-[320px] text-[13px] leading-5 text-[color:var(--ink-sub,#6B7684)]">
          {failed
            ? job.error
            : unavailable
              ? connectionError || job?.error
              : retryLabel || '화면을 새로고침해도 작업은 계속되고, 같은 상태로 복구됩니다.'}
        </p>
      </div>

      {!failed && !unavailable ? (
        <>
          <div
            className="h-2 w-full max-w-[300px] overflow-hidden rounded-full bg-[color:var(--line,#E5E8EB)]"
            role="progressbar"
            aria-label="AI 일정 생성 진행률"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <div
              className="h-full rounded-full bg-[color:var(--primary,#3182F6)] transition-[width] duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p role="status" aria-live="polite" className="sr-only">
            {retryLabel ?? STEPS[Math.min(currentIndex, STEPS.length - 1)]?.label}
          </p>
          <ol aria-hidden className="w-full max-w-[300px] space-y-2.5">
            {STEPS.map(({ stage, label }, index) => {
              const done = index < currentIndex || job?.stage === 'completed';
              const current = index === currentIndex && job?.stage !== 'completed';
              return (
                <li
                  key={stage}
                  className={`flex items-center gap-2.5 text-[14px] transition-colors duration-300 ${
                    current
                      ? 'font-bold text-[color:var(--ink,#191F28)]'
                      : done
                        ? 'text-[color:var(--ink-sub,#6B7684)]'
                        : 'text-[color:var(--ink-faint,#B0B8C1)]'
                  }`}
                >
                  <span
                    className={`flex size-5 shrink-0 items-center justify-center rounded-full transition-colors duration-300 ${
                      done
                        ? 'bg-[color:var(--primary,#3182F6)] text-white'
                        : current
                          ? 'border-2 border-[color:var(--primary,#3182F6)]'
                          : 'border-2 border-[color:var(--line,#E5E8EB)]'
                    }`}
                  >
                    {done ? <LuCheck className="size-3" /> : null}
                    {current ? (
                      <span className="size-1.5 motion-safe:animate-pulse rounded-full bg-[color:var(--primary,#3182F6)]" />
                    ) : null}
                  </span>
                  <span>{label}</span>
                </li>
              );
            })}
          </ol>
        </>
      ) : (
        <div className="w-full max-w-[300px] space-y-2">
          <button
            type="button"
            onClick={failed ? onRetry : onRefresh}
            disabled={retrying || loadingStatus}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-[14px] bg-[color:var(--primary,#3182F6)] text-[14px] font-bold text-white disabled:opacity-50"
          >
            <LuRotateCcw className={`size-4 ${retrying || loadingStatus ? 'animate-spin' : ''}`} />
            {failed
              ? retrying
                ? '다시 등록하는 중…'
                : 'AI 일정 다시 만들기'
              : '상태 다시 확인하기'}
          </button>
          {retryError ? (
            <p role="alert" className="text-center text-[12px] text-[color:var(--danger,#F04452)]">
              {retryError}
            </p>
          ) : null}
          <Link
            href="/trips"
            className="inline-flex h-11 w-full items-center justify-center text-[13px] font-semibold text-[color:var(--ink-sub,#6B7684)]"
          >
            내 여행으로 돌아가기
          </Link>
        </div>
      )}
    </div>
  );
}
