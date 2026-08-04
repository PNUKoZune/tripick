'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';
import './globals.css';

// 루트 레이아웃까지 날아간 예외의 최종 경계. 여기선 layout.tsx 가 안 붙으므로
// html·body 와 globals.css 를 직접 갖춰야 한다.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="ko">
      <body>
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
          <h1 className="text-[20px] font-bold leading-[28px] text-[#191F28]">
            문제가 생겨 화면을 열지 못했어요
          </h1>
          <p className="text-[15px] leading-[22px] text-[#4E5968]">
            잠시 후 다시 시도해 주세요. 계속 이러면 오류가 자동으로 전달됩니다.
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-2 inline-flex h-14 items-center justify-center rounded-[18px] bg-[#3182F6] px-5 text-[16px] font-semibold leading-[24px] text-white transition hover:bg-[#1B64DA]"
          >
            다시 시도
          </button>
        </main>
      </body>
    </html>
  );
}
