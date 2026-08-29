'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';

import { getReactNativeWebView } from '@/shared/rn-bridge/rn-webview';

import {
  applyTheme,
  readThemePreference,
  subscribeSystemTheme,
  subscribeThemePreference,
  systemTheme,
  writeThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from './theme';

type ThemeContextValue = {
  /** 사용자가 고른 값 (system 포함) */
  preference: ThemePreference;
  /** 실제 적용 중인 값 */
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
};

/**
 * 테마 선택을 읽고 바꾸는 훅.
 *
 * 저장소(localStorage)와 OS 설정을 각각 외부 스토어로 구독한다 — 마운트 후 effect 로
 * 상태를 보정하는 방식은 서버 렌더 결과와 어긋나 연쇄 렌더를 만든다.
 * `useSyncExternalStore` 는 서버 스냅샷을 따로 받아 그 전환을 React 가 처리한다.
 */
export function useTheme(): ThemeContextValue {
  // 서버·하이드레이션 시점 스냅샷은 기본값. 실제 색은 이미 head 인라인 스크립트가
  // 첫 페인트 전에 칠해 둔 상태라, 이 값이 늦게 맞춰져도 화면이 번쩍이지 않는다.
  const preference = useSyncExternalStore(
    subscribeThemePreference,
    readThemePreference,
    () => 'system' as ThemePreference,
  );
  const systemResolved = useSyncExternalStore(
    subscribeSystemTheme,
    systemTheme,
    () => 'light' as ResolvedTheme,
  );
  const resolved: ResolvedTheme = preference === 'system' ? systemResolved : preference;

  // 선택이 바뀌었거나(사용자) OS 가 바뀌었을 때(시스템 추종) 문서에 반영한다.
  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  // RN 셸은 자기 배경·상태바 색을 OS 설정으로 정한다. 웹에서 OS 와 다른 테마를 고르면
  // 웹뷰 바깥 테두리와 상태바만 반대 색으로 남으므로, 해석된 값을 셸에도 알린다.
  useEffect(() => {
    getReactNativeWebView()?.postMessage(JSON.stringify({ type: 'THEME_CHANGE', theme: resolved }));
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    writeThemePreference(next);
  }, []);

  return { preference, resolved, setPreference };
}

/** 앱 어디서든 테마가 적용되도록 훅을 한 번 실행시키는 자리. 상태는 외부 스토어에 있어 컨텍스트가 필요 없다. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  useTheme();
  return <>{children}</>;
}
