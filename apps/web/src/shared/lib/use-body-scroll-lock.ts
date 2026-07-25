'use client';

import { useEffect } from 'react';

// 여러 오버레이가 겹쳐도 body 잠금은 하나. refcount 로 세서 마지막 하나가 닫힐 때만 푼다.
// (컴포넌트별로 각자 저장/복원하면 먼저 닫힌 오버레이가 아직 열린 오버레이 뒤 페이지를 풀어버린다)
let lockCount = 0;
let savedOverflow = '';

/**
 * 오버레이가 떠 있는 동안 body 스크롤을 잠근다. 중첩되면 refcount 로 합산해
 * 전부 닫힌 뒤에야 원래 값으로 되돌린다.
 */
export function useBodyScrollLock(active = true) {
  useEffect(() => {
    if (!active) return;
    if (lockCount === 0) {
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    lockCount += 1;
    return () => {
      lockCount -= 1;
      if (lockCount === 0) document.body.style.overflow = savedOverflow;
    };
  }, [active]);
}
