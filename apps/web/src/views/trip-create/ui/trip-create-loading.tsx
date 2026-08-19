'use client';

import { useEffect, useState } from 'react';
import { LuCheck, LuPlane } from 'react-icons/lu';

/**
 * 진행 단계. 실제 서버 진행률을 받아오는 게 아니라 체감용 타임라인이라,
 * 마지막 단계는 응답이 늦어도 "거의 다 됐어요"에서 멈춘 채 기다린다.
 */
const STEPS = [
  '취향에 맞는 장소를 고르는 중',
  '이동 동선을 다듬는 중',
  '일정표를 만드는 중',
] as const;
const STEP_MS = 2600;

/** 여행 생성 중 표시하는 풀스크린 로딩 화면 (하단 탭·CTA 위를 덮음). */
export function TripCreateLoading() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    // 마지막 단계에 도달하면 더 넘기지 않는다 — 순환하면 끝난 단계가 다시 "진행 중"이 돼
    // 진행이 되돌아간 것처럼 보인다.
    if (step >= STEPS.length - 1) return;
    const timer = setTimeout(() => setStep((prev) => prev + 1), STEP_MS);
    return () => clearTimeout(timer);
  }, [step]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-7 bg-[color:var(--card,#fff)] px-8">
      <div className="relative flex size-16 items-center justify-center">
        <span className="absolute inset-0 motion-safe:animate-spin rounded-full border-[3px] border-[color:var(--line,#E5E8EB)] border-t-[color:var(--primary,#3182F6)]" />
        <LuPlane className="size-6 text-[color:var(--primary,#3182F6)]" aria-hidden />
      </div>
      <div className="text-center">
        <p className="text-[17px] font-bold text-[color:var(--ink,#191F28)]">
          여행을 만들고 있어요
        </p>
      </div>
      {/* 현재 단계만 읽어 준다 — 목록 전체를 aria-live 로 두면 단계가 넘어갈 때마다
          지나간 줄까지 다시 읽힌다. */}
      <p role="status" aria-live="polite" className="sr-only">
        {STEPS[step]}
      </p>
      <ol aria-hidden className="w-full max-w-[280px] space-y-2.5">
        {STEPS.map((label, index) => {
          const done = index < step;
          const current = index === step;
          return (
            <li
              key={label}
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
                {done ? <LuCheck className="app-badge-pop size-3" /> : null}
                {current ? (
                  <span className="size-1.5 motion-safe:animate-pulse rounded-full bg-[color:var(--primary,#3182F6)]" />
                ) : null}
              </span>
              <span>{label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
