'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { getReactNativeWebView } from '@/shared/rn-bridge/rn-webview';

/** 이 속성이 붙은 요소 안에서 시작한 터치는 당겨서 새로고침으로 보지 않는다(지도처럼 자체 드래그가 있는 면). */
export const PULL_REFRESH_IGNORE_ATTR = 'data-pull-refresh-ignore';

/** 손가락 이동량 → 인디케이터 이동량 감쇠. 1:1 이면 살짝만 당겨도 임계를 넘는다. */
const RESISTANCE = 0.5;
/** 감쇠 후 이만큼 내려오면 손을 뗄 때 새로고침한다. */
export const PULL_THRESHOLD = 72;
/** 인디케이터가 더 내려오지 않는 한계. */
const PULL_MAX = 110;
/** 방향 판정 전 흔들림 허용치 — 탭·가로 스와이프를 당김으로 오인하지 않게. */
const START_SLOP = 8;
/** 응답이 빨라도 스피너가 한 바퀴는 보이게 해, 새로고침이 됐다는 걸 알 수 있게 한다. */
const MIN_SPIN_MS = 600;
/** 응답이 안 오면 이 시간 뒤 스피너를 거둔다 — 재조회는 계속 돌고, 다음 당김이 막히지 않게 한다. */
const MAX_SPIN_MS = 8000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Gesture = { startX: number; startY: number; pulling: boolean };

const noopSubscribe = () => () => {};

function pageScrollTop(): number {
  return document.scrollingElement?.scrollTop ?? window.scrollY;
}

/**
 * 터치 지점부터 위로 올라가며, 이미 아래로 스크롤된 내부 스크롤 영역이 있으면 true.
 * 그 안에서 아래로 당기는 건 "위로 스크롤" 이지 새로고침이 아니다
 * (예: 여행 중 화면은 문서가 아니라 하단 일정 패널이 스크롤된다).
 */
function insideScrolledContainer(target: Element | null): boolean {
  for (let el = target; el && el !== document.body; el = el.parentElement) {
    if (el.scrollTop > 0 && el.scrollHeight > el.clientHeight) {
      const { overflowY } = getComputedStyle(el);
      if (overflowY === 'auto' || overflowY === 'scroll') return true;
    }
  }
  return false;
}

function canStartPull(target: EventTarget | null): boolean {
  if (pageScrollTop() > 0) return false;
  // 바텀시트·모달이 떠 있으면 useBodyScrollLock 이 body 를 잠근다 — 뒤 페이지를 새로고침하지 않는다.
  if (document.body.style.overflow === 'hidden') return false;
  const el = target instanceof Element ? target : null;
  if (el?.closest(`[${PULL_REFRESH_IGNORE_ATTR}]`)) return false;
  return !insideScrolledContainer(el);
}

/**
 * RN 웹뷰 안에서 화면 최상단을 아래로 당겼다 놓으면 활성 쿼리를 다시 받아온다.
 *
 * 브라우저(모바일 Chrome·Safari)는 자체 당겨서 새로고침이 있어 켜지 않는다 — 켜면 두 개가 겹친다.
 * 웹뷰의 네이티브 옵션(pullToRefreshEnabled)은 iOS 전용이라 안드로이드에서 동작하지 않고,
 * 동작해도 페이지 전체 리로드라 인증 복구·지도 SDK 로드가 처음부터 다시 돈다. 그래서 웹에서
 * 제스처를 직접 받고, 새로고침은 화면에 붙은 React Query 쿼리 재조회로 한다.
 */
export function usePullToRefresh() {
  const queryClient = useQueryClient();
  // RN 컨테이너는 페이지 스크립트보다 먼저 브리지를 주입하고 이후 바뀌지 않는다 — 구독할 게 없다.
  // 서버 스냅샷은 false 라 하이드레이션 불일치 없이 클라이언트에서만 켜진다.
  const enabled = useSyncExternalStore(
    noopSubscribe,
    () => getReactNativeWebView() !== null,
    () => false,
  );
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [dragging, setDragging] = useState(false);

  const gestureRef = useRef<Gesture | null>(null);
  const distanceRef = useRef(0);
  const refreshingRef = useRef(false);

  const refresh = useCallback(async () => {
    refreshingRef.current = true;
    setRefreshing(true);
    setDistance(PULL_THRESHOLD);
    try {
      await Promise.race([
        Promise.all([queryClient.refetchQueries({ type: 'active' }), wait(MIN_SPIN_MS)]),
        wait(MAX_SPIN_MS),
      ]);
    } finally {
      refreshingRef.current = false;
      distanceRef.current = 0;
      setRefreshing(false);
      setDistance(0);
    }
  }, [queryClient]);

  useEffect(() => {
    if (!enabled) return;

    const updateDistance = (value: number) => {
      distanceRef.current = value;
      setDistance(value);
    };

    const onTouchStart = (e: TouchEvent) => {
      gestureRef.current = null;
      if (refreshingRef.current || e.touches.length !== 1) return;
      if (!canStartPull(e.target)) return;
      const touch = e.touches[0]!;
      gestureRef.current = { startX: touch.clientX, startY: touch.clientY, pulling: false };
    };

    const onTouchMove = (e: TouchEvent) => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      if (e.touches.length !== 1) {
        gestureRef.current = null;
        setDragging(false);
        updateDistance(0);
        return;
      }
      const touch = e.touches[0]!;
      const dx = touch.clientX - gesture.startX;
      const dy = touch.clientY - gesture.startY;

      if (!gesture.pulling) {
        if (Math.abs(dx) < START_SLOP && Math.abs(dy) < START_SLOP) return;
        // 위로 밀거나 가로 스와이프(캐러셀·탭)면 이번 터치는 손대지 않는다.
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || pageScrollTop() > 0) {
          gestureRef.current = null;
          return;
        }
        gesture.pulling = true;
        setDragging(true);
      }

      // 당기는 동안은 웹뷰 기본 오버스크롤(안드로이드 스트레치·iOS 바운스)을 막아 인디케이터와 겹치지 않게 한다.
      if (e.cancelable) e.preventDefault();
      updateDistance(Math.min(PULL_MAX, Math.max(0, dy - START_SLOP) * RESISTANCE));
    };

    const onTouchEnd = () => {
      const gesture = gestureRef.current;
      gestureRef.current = null;
      if (!gesture?.pulling) return;
      setDragging(false);
      if (distanceRef.current >= PULL_THRESHOLD) {
        void refresh();
      } else {
        updateDistance(0);
      }
    };

    // touchmove 는 preventDefault 를 써야 해서 passive 가 아니어야 한다.
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [enabled, refresh]);

  return { enabled, distance, refreshing, dragging };
}
