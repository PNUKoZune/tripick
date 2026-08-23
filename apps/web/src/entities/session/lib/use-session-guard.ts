'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { setSessionFlash } from '../model/session-flash';
import { getStoredSession } from '../model/session-storage';
import { useHasSession } from './use-has-session';

export type SessionGuardState = 'pending' | 'authenticated';
export type GuestGuardState = 'redirecting' | 'guest';

/**
 * 로그인 필수 가드. 세션 없으면 `redirectTo` 로 이동.
 * - 'pending': SSR·하이드레이션 첫 렌더, 또는 세션 없음(리다이렉트 진행 중)
 * - 'authenticated': 세션 있음, 컨텐츠 렌더 OK
 *
 * 세션 판정은 effect 가 아니라 useSyncExternalStore(useHasSession)로 한다 —
 * effect 방식은 모든 클라이언트 내비게이션마다 'pending' 프레임(placeholder 번쩍)을
 * 강제하지만, 스토어 방식은 첫 렌더부터 세션을 알아 탭 전환이 즉시 컨텐츠로 그려진다.
 * placeholder 는 진짜 첫 로드(SSR 스냅샷 false)에만 남는다.
 */
export function useSessionGuard(redirectTo = '/login'): SessionGuardState {
  const router = useRouter();
  const hasSession = useHasSession();

  useEffect(() => {
    // 하이드레이션 첫 렌더의 스냅샷(false)이 아니라 스토리지를 직접 재확인하고 리다이렉트한다
    if (!getStoredSession()) {
      // 아무 설명 없이 로그인 화면으로 튕기면 "눌렀는데 엉뚱한 데로 갔다"로 읽힌다.
      // 토스트는 이 화면에서 띄우면 리다이렉트와 함께 사라지므로 플래시로 넘겨,
      // 도착한 화면의 SessionFlashToast 가 대신 띄운다.
      setSessionFlash({
        title: '로그인이 필요해요',
        message: '로그인하면 이어서 볼 수 있어요.',
        tone: 'warning',
      });
      redirectWithFallback(router.replace, redirectTo);
    }
  }, [router, redirectTo]);

  return hasSession ? 'authenticated' : 'pending';
}

/**
 * 로그인 상태이면 차단하는 가드 (signup/login/forgot-password 용).
 * 세션이 없으면 첫 렌더부터 'guest' 라 폼이 즉시 그려진다.
 */
export function useGuestGuard(redirectTo = '/'): GuestGuardState {
  const router = useRouter();
  const hasSession = useHasSession();

  useEffect(() => {
    if (getStoredSession()) {
      redirectWithFallback(router.replace, redirectTo);
    }
  }, [router, redirectTo]);

  return hasSession ? 'redirecting' : 'guest';
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
