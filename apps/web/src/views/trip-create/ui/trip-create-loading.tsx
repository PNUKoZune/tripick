'use client';

import { useEffect, useState } from 'react';
import { LuPlane } from 'react-icons/lu';

const MESSAGES = [
  'AI가 여행 일정을 준비하고 있어요',
  '취향에 맞는 장소를 고르고 있어요',
  '이동 동선을 다듬고 있어요',
  '거의 다 됐어요',
];

/** 여행 생성 중 표시하는 풀스크린 로딩 화면 (하단 탭·CTA 위를 덮음). */
export function TripCreateLoading() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % MESSAGES.length);
    }, 2200);
    return () => clearInterval(timer);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-7 bg-[color:var(--card,#fff)] px-8"
    >
      <div className="relative flex size-16 items-center justify-center">
        <span className="absolute inset-0 animate-spin rounded-full border-[3px] border-[color:var(--line,#E5E8EB)] border-t-[color:var(--primary,#3182F6)]" />
        <LuPlane className="size-6 text-[color:var(--primary,#3182F6)]" />
      </div>
      <div className="text-center">
        <p className="text-[17px] font-bold text-[color:var(--ink,#191F28)]">
          여행을 만들고 있어요
        </p>
        <p className="mt-2 text-[14px] text-[color:var(--ink-sub,#6B7684)]">{MESSAGES[index]}</p>
      </div>
    </div>
  );
}
