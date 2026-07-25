'use client';

import { useSyncExternalStore } from 'react';

import { getStoredSession } from '../model/session-storage';

// 세션 존재 여부는 외부 스토어(localStorage)를 읽을 뿐 로컬에서 바뀌지 않으므로,
// 구독 없는 useSyncExternalStore 로 SSR-safe 하게 노출한다. 서버 스냅샷은 항상 false 라
// 하이드레이션 불일치가 없고, 클라이언트 마운트 후 실제 값으로 재렌더된다.
const noopSubscribe = () => () => {};

/**
 * 로그인 세션 존재 여부. 쿼리·소켓 게이팅용.
 * 서버/하이드레이션 시점엔 false, 마운트 후 실제 값.
 */
export function useHasSession(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => Boolean(getStoredSession()),
    () => false,
  );
}
