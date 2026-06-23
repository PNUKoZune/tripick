'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { getStoredSession } from '../model/session-storage';

export type SessionGuardState = 'pending' | 'authenticated' | 'redirecting';
export type GuestGuardState = 'pending' | 'guest' | 'redirecting';

/**
 * 로그인 필수 가드. 세션 없으면 `redirectTo` 로 이동.
 * - 'pending': 첫 렌더, 아직 검사 전 (SSR 결과)
 * - 'authenticated': 세션 있음, 컨텐츠 렌더 OK
 * - 'redirecting': 세션 없음, 리다이렉트 중 (스피너만 노출)
 */
export function useSessionGuard(redirectTo = '/login'): SessionGuardState {
  const router = useRouter();
  const [state, setState] = useState<SessionGuardState>('pending');

  useEffect(() => {
    const exists = Boolean(getStoredSession());
    if (exists) {
      setState('authenticated');
      return;
    }
    setState('redirecting');
    redirectWithFallback(router.replace, redirectTo);
  }, [router, redirectTo]);

  return state;
}

/**
 * 로그인 상태이면 차단하는 가드 (signup/login/forgot-password 용).
 */
export function useGuestGuard(redirectTo = '/'): GuestGuardState {
  const router = useRouter();
  const [state, setState] = useState<GuestGuardState>('pending');

  useEffect(() => {
    const exists = Boolean(getStoredSession());
    if (!exists) {
      setState('guest');
      return;
    }
    setState('redirecting');
    redirectWithFallback(router.replace, redirectTo);
  }, [router, redirectTo]);

  return state;
}

/**
 * Next.js router.replace 가 일부 환경(RN WebView 등) 에서 silently fail 하는 케이스 대비.
 * 100ms 안에 URL 이 안 바뀌면 하드 네비게이션으로 강제 이동.
 */
function redirectWithFallback(replace: (path: string) => void, to: string) {
  replace(to);
  if (typeof window === 'undefined') return;
  const targetPath = to.split('?')[0]?.split('#')[0] ?? to;
  window.setTimeout(() => {
    if (window.location.pathname !== targetPath) {
      window.location.replace(to);
    }
  }, 100);
}
