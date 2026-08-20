'use client';

import { useEffect, useState } from 'react';

import { usePrefersReducedMotion } from './use-prefers-reduced-motion';

/**
 * 퇴장 애니메이션이 끝날 때까지 언마운트를 미룬다.
 *
 * `open` 이 false 로 떨어지면 곧바로 사라지는 대신 `durationMs` 동안 `closing` 을 켜 두고,
 * 그 뒤에야 `mounted` 를 내린다. 호출부는 `mounted` 로 렌더 여부를, `closing` 으로
 * 퇴장 클래스를 정한다.
 *
 * reduced-motion 이면 대기 없이 즉시 내린다 — 퇴장 keyframe 도 어차피 안 도는데
 * 기다리기만 하면 닫기 반응이 느려진 것처럼 보인다.
 */
export function useExitTransition(
  open: boolean,
  durationMs: number,
): { mounted: boolean; closing: boolean } {
  const reduced = usePrefersReducedMotion();
  const [exiting, setExiting] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);

  // open 이 바뀐 프레임에 파생 상태를 맞춘다(effect 가 아니라 렌더 중 — React 가 권장하는
  // "prop 변화에서 state 유도" 패턴이라 추가 렌더 없이 같은 커밋에 반영된다).
  if (prevOpen !== open) {
    setPrevOpen(open);
    setExiting(!open && !reduced);
  }

  useEffect(() => {
    if (!exiting) return;
    const timer = window.setTimeout(() => setExiting(false), durationMs);
    return () => window.clearTimeout(timer);
  }, [exiting, durationMs]);

  return { mounted: open || exiting, closing: exiting };
}
