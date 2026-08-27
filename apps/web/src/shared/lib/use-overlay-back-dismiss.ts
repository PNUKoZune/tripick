'use client';

import { useEffect, useRef } from 'react';

import { getReactNativeWebView } from '@/shared/rn-bridge/rn-webview';

/**
 * 열려 있는 오버레이(바텀시트·모달)의 닫기 핸들러 스택.
 *
 * RN 셸의 안드로이드 뒤로가기는 웹이 무엇을 띄웠는지 모른 채 네이티브가 먼저 가로챈다 —
 * 탭 루트면 "한 번 더 누르면 종료", 그 밖이면 웹뷰 히스토리 back. 둘 다 시트를 열어 둔 채
 * 누르면 시트는 그대로 남고 앱이 꺼지거나 화면만 빠져나간다. 그래서 오버레이가 하나라도
 * 열리면 네이티브에 알려 두고, 네이티브는 그 동안 뒤로가기를 아래 전역 함수 호출로 돌린다.
 */
type Closer = () => void;

const stack: Closer[] = [];
let lastSentOpen: boolean | null = null;

/** 네이티브가 injectJavaScript 로 부르는 창구. 닫을 게 있었으면 true. */
function closeTopOverlay(): boolean {
  const close = stack.at(-1);
  if (!close) return false;
  close();
  return true;
}

type OverlayBackWindow = Window & { __tripickBack?: () => boolean };

function syncNative() {
  const open = stack.length > 0;
  if (open === lastSentOpen) return;
  lastSentOpen = open;
  getReactNativeWebView()?.postMessage(JSON.stringify({ type: 'OVERLAY_STATE', open }));
}

/**
 * 오버레이가 열려 있는 동안 하드웨어 뒤로가기를 "이 오버레이 닫기" 로 소비한다.
 * ESC 와 같은 조건으로 건다 — 닫기 핸들러가 없는(닫히면 안 되는) 상태면 등록하지 않는다.
 */
export function useOverlayBackDismiss(onDismiss: (() => void) | undefined, active: boolean) {
  // 호출부가 인라인 함수를 넘겨도 스택 등록/해제가 매 렌더 반복되지 않도록 최신 값만 참조한다.
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });

  const dismissable = typeof onDismiss === 'function';

  useEffect(() => {
    if (!active || !dismissable || typeof window === 'undefined') return;

    (window as OverlayBackWindow).__tripickBack = closeTopOverlay;

    const entry: Closer = () => dismissRef.current?.();
    stack.push(entry);
    syncNative();

    return () => {
      const index = stack.lastIndexOf(entry);
      if (index >= 0) stack.splice(index, 1);
      syncNative();
    };
  }, [active, dismissable]);
}
