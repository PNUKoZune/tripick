'use client';

import { useSyncExternalStore } from 'react';

import { subscribeSessionChange } from '@/shared/lib/session-token';

import { getStoredSession } from '../model/session-storage';

// 세션 존재 여부는 외부 스토어(localStorage)라 useSyncExternalStore 로 SSR-safe 하게 노출한다.
// 서버 스냅샷은 항상 false 라 하이드레이션 불일치가 없고, 클라이언트 마운트 후 실제 값으로 재렌더된다.
//
// 구독이 필요한 이유: 401 로 세션이 정리돼도 구독이 없으면 화면이 다시 그려지지 않아,
// 가드가 다음 내비게이션까지 안 돌고 만료 안내도 그때서야 뜬다.

/**
 * 로그인 세션 존재 여부. 쿼리·소켓 게이팅용.
 * 서버/하이드레이션 시점엔 false, 마운트 후 실제 값.
 */
export function useHasSession(): boolean {
  return useSyncExternalStore(
    subscribeSessionChange,
    () => Boolean(getStoredSession()),
    () => false,
  );
}

/**
 * 세션 판정을 3상태로 노출한다. `useHasSession` 의 `false` 는 "세션 없음" 과
 * "아직 모름(서버 스냅샷)" 이 겹쳐 있어, 그 둘을 갈라 그려야 하는 화면에서 쓴다.
 *
 * 두 값을 한 스토어에서 뽑는 이유: 마운트 플래그(useEffect)로 '모름' 을 따로 만들면
 * 세션 확정보다 한 프레임 늦게 풀려 로그인 사용자에게 비로그인 화면이 스친다.
 */
export type SessionState = 'pending' | 'authenticated' | 'guest';

export function useSessionState(): SessionState {
  return useSyncExternalStore(
    subscribeSessionChange,
    () => (getStoredSession() ? 'authenticated' : 'guest'),
    () => 'pending' as SessionState,
  );
}
