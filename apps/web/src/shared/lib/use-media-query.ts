'use client';

import { useEffect, useState } from 'react';

/**
 * CSS media query 매칭 여부를 구독한다. SSR/최초 렌더에서는 `false` 로 시작하고
 * 마운트 후 실제 값으로 보정한다 (하이드레이션 불일치 방지).
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [query]);

  return matches;
}
