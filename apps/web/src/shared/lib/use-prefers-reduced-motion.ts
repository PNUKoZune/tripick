'use client';

import { useMediaQuery } from './use-media-query';

/**
 * `prefers-reduced-motion: reduce` 여부. CSS 는 `@media`·`motion-safe:` 로 알아서
 * 걸러지지만, 인라인 style 로 거는 transition(BottomSheet 등)은 미디어 쿼리를 못 타므로
 * JS 에서 직접 물어봐야 한다.
 *
 * SSR·첫 렌더에서는 false(=모션 허용)로 시작한다 — 마운트 직후 보정되며, 그 한 프레임에
 * 애니메이션이 시작되진 않는다(시트는 열릴 때 비로소 마운트된다).
 */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}
