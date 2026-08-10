'use client';

import { useEffect, useState } from 'react';

import { rateLimitRetrySeconds } from '@/shared/api/client';

/**
 * 429 에러의 `Retry-After` 를 초 단위로 세어 남은 대기 시간을 돌려준다.
 * 0 이면 대기 없음(재시도 가능). 429 가 아닌 에러·에러 없음도 0.
 */
export function useRetryCountdown(error: unknown): number {
  const seconds = rateLimitRetrySeconds(error);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 새 429 를 받으면 카운트다운을 다시 시작하는 side-effect
    setRemaining(seconds);
    if (seconds <= 0) return;
    // 남은 초를 데드라인에서 역산한다 — 인터벌이 밀리거나 탭이 백그라운드로 가도 초가 어긋나지 않는다.
    const deadline = Date.now() + seconds * 1000;
    const timer = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) window.clearInterval(timer);
    }, 500);
    return () => window.clearInterval(timer);
  }, [error, seconds]);

  return remaining;
}
