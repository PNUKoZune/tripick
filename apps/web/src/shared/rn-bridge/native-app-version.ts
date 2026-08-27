'use client';

import { useSyncExternalStore } from 'react';

/**
 * RN 셸이 알려준 앱 버전(versionName) 보관소.
 *
 * 설정의 "버전" 은 웹 빌드 버전(NEXT_PUBLIC_APP_VERSION = apps/web/package.json)인데, 앱에서
 * 보면 스토어 버전과 달라 헷갈린다. 웹 배포와 앱 릴리스는 주기가 달라 숫자를 맞출 수 없으니,
 * 앱 안에서는 네이티브가 알려 준 값을 쓰고 브라우저에선 웹 빌드 버전을 그대로 둔다.
 *
 * 값은 웹이 리스너를 붙였다고 알린 직후(WEB_READY 응답) 한 번 오므로, 설정 화면이 그보다 늦게
 * 마운트돼도 놓치지 않도록 모듈 전역에 담아 둔다.
 */
let nativeAppVersion: string | null = null;
const listeners = new Set<() => void>();

export function setNativeAppVersion(version: string) {
  if (!version || version === nativeAppVersion) return;
  nativeAppVersion = version;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 앱 안이면 앱 버전, 브라우저 단독이면 null. */
export function useNativeAppVersion(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => nativeAppVersion,
    () => null,
  );
}
