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
  // wvr-scope 로 배경·글자가 팔레트(다크 포함)를 따라간다 — 라이트 고정이면
  // 다크 화면 사이에서 흰 화면이 번쩍인다. 첫 로드에만 보이는 화면이라 스코프 무해.
  //
  // 글자만 있으면 "멈춘 빈 화면"으로 읽힌다. 스피너를 같이 둬서 진행 중임을 보이게 하되,
  // reduced-motion 에서는 회전 없이 링만 남도록 motion-safe 로 건다.
  return (
    <div
      role="status"
      aria-live="polite"
      className="wvr-scope flex min-h-dvh flex-col items-center justify-center gap-3"
    >
      <span
        aria-hidden
        className="size-7 rounded-full border-2 border-[color:var(--line)] border-t-[color:var(--primary)] motion-safe:animate-spin"
      />
      <span className="text-[13px] font-semibold text-[color:var(--ink-faint)]">
        잠시만 기다려 주세요…
      </span>
    </div>
  );
}
