'use client';

import type { ReactNode } from 'react';

import { useGuestGuard, useSessionGuard } from '../lib/use-session-guard';

type CommonProps = {
  children: ReactNode;
  /** 검사 중 / 리다이렉트 중에 보일 화면. 기본은 옅은 스피너 영역. */
  fallback?: ReactNode;
};

/**
 * 로그인 필수 페이지 래퍼. 세션 없으면 `redirectTo`(기본 /login) 로 자동 이동.
 * 검사 중·리다이렉트 중에는 `fallback` 만 노출돼 깜빡임 차단.
 */
export function SessionGuard({
  children,
  fallback,
  redirectTo,
}: CommonProps & { redirectTo?: string }) {
  const state = useSessionGuard(redirectTo);
  if (state !== 'authenticated') return <>{fallback ?? <GuardPlaceholder />}</>;
  return <>{children}</>;
}

/**
 * 비-로그인 페이지 래퍼 (signup/login/forgot-password). 로그인 상태이면 `redirectTo`(기본 /) 로 이동.
 */
export function GuestGuard({
  children,
  fallback,
  redirectTo,
}: CommonProps & { redirectTo?: string }) {
  const state = useGuestGuard(redirectTo);
  if (state !== 'guest') return <>{fallback ?? <GuardPlaceholder />}</>;
  return <>{children}</>;
}

function GuardPlaceholder() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#F7F8FA]">
      <div className="text-[13px] font-semibold text-[#8B95A1]">잠시만 기다려 주세요…</div>
    </div>
  );
}
