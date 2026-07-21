'use client';

import { useWebPush } from './use-web-push';

/** 브라우저 단독 사용자 웹 푸시 배선을 마운트하는 무렌더 컴포넌트(RnBridge 와 대칭). */
export function WebPush() {
  useWebPush();
  return null;
}
