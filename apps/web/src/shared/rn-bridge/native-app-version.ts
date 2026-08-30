'use client';

import { useSyncExternalStore } from 'react';

/**
 * RN 셸이 알려준 앱 버전(versionName) 보관소.
 *
 * 설정의 "버전" 행은 **앱에서만** 뜬다. 웹 배포(push 마다)와 앱 릴리스(스토어 심사)는 주기가
 * 달라 숫자를 맞출 수 없고, 브라우저에서 웹 빌드 번호를 보여 봐야 사용자에게 의미가 없어
 * 아예 감춘다. 값이 null 이면 브라우저 단독이라는 뜻이라 설정 화면이 행 자체를 렌더하지 않는다.
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
