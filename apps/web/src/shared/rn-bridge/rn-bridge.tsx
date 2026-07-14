'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { updateFcmToken } from '@/entities/user';
import { getStoredSession } from '@/entities/session/model/session-storage';
import { queryKeys } from '@/shared/api/query-keys';
import {
  clearPendingFcmToken,
  getLastFcmToken,
  setLastFcmToken,
  setPendingFcmToken,
} from './fcm-token-storage';

type RnBridgeMessage =
  | { type: 'FCM_TOKEN'; token: string }
  | { type: 'PUSH_NOTIFICATION'; data?: { data?: Record<string, string> } }
  | { type: 'NOTIFICATION_TAP'; data?: Record<string, string> }
  | { type: 'LOCATION_UPDATE'; lat: number; lng: number; accuracy?: number; timestamp?: number }
  | { type: 'LOCATION_ERROR'; code: number; message: string };

/**
 * 푸시 data payload → 이동할 경로. 백엔드는 data 에 category(=type) 와 tripId 를 싣는다.
 * - friend_request·trip_invite: 수락/거절 액션이 인박스 가상·영속 row 에 있으므로 /inbox
 * - 여행 관련(replan·weather·reminder·general): tripId 있으면 해당 여행, 없으면 인박스
 */
function routeForNotification(data?: Record<string, string>): string | null {
  if (!data) return null;
  const category = data.category ?? data.type;
  const tripId = data.tripId;
  switch (category) {
    case 'friend_request':
    case 'trip_invite':
      return '/inbox';
    case 'replan_ready':
    case 'weather_alert':
    case 'trip_reminder':
    case 'general':
      return tripId ? `/planner?tripId=${tripId}` : '/inbox';
    default:
      return '/inbox';
  }
}

/**
 * RN WebView → Web 브릿지 수신부.
 * RN App.tsx 의 postToWeb() 가 보내는 메시지를 받아 처리한다.
 * - FCM_TOKEN: 백엔드에 등록 (이미 등록된 동일 토큰은 중복 호출 안 함)
 * - PUSH_NOTIFICATION: 인박스 invalidate → 사용자가 보고 있는 화면이 자동 갱신
 *
 * 브라우저 단독으로 열린 경우엔 message 자체가 오지 않아 자연스럽게 no-op.
 */
export function useRnBridge() {
  const queryClient = useQueryClient();
  const router = useRouter();

  useEffect(() => {
    if (typeof window === 'undefined') return;

    function handle(event: MessageEvent) {
      // RN postMessage 는 string. 다른 origin/포맷의 메시지는 무시.
      if (typeof event.data !== 'string') return;
      let msg: RnBridgeMessage | null = null;
      try {
        msg = JSON.parse(event.data) as RnBridgeMessage;
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object' || !('type' in msg)) return;

      if (msg.type === 'FCM_TOKEN' && msg.token) {
        // 세션 없으면(로그인 전) 등록할 데가 없으니 보관해뒀다가 로그인 완료 시 flush.
        if (!getStoredSession()) {
          setPendingFcmToken(msg.token);
          return;
        }
        if (getLastFcmToken() === msg.token) return;
        updateFcmToken(msg.token)
          .then(() => {
            setLastFcmToken(msg.token);
            clearPendingFcmToken();
          })
          .catch((err) => console.warn('[rn-bridge] fcm-token update failed:', err));
        return;
      }

      if (msg.type === 'PUSH_NOTIFICATION') {
        queryClient.invalidateQueries({ queryKey: queryKeys.inbox.list });
        return;
      }

      if (msg.type === 'NOTIFICATION_TAP') {
        // 탭으로 진입했으니 인박스도 최신화하고 해당 화면으로 이동.
        queryClient.invalidateQueries({ queryKey: queryKeys.inbox.list });
        const route = routeForNotification(msg.data);
        if (route) router.push(route);
        return;
      }
    }

    window.addEventListener('message', handle);
    // 리스너를 붙인 직후 RN 에 알린다 — 종료 상태 푸시 탭으로 켜졌을 때 RN 이 보관한
    // NOTIFICATION_TAP 을 이 시점에 flush 해야 유실 없이 라우팅된다.
    const rn = (window as unknown as { ReactNativeWebView?: { postMessage(m: string): void } })
      .ReactNativeWebView;
    rn?.postMessage(JSON.stringify({ type: 'WEB_READY' }));

    return () => window.removeEventListener('message', handle);
  }, [queryClient, router]);
}

export function RnBridge() {
  useRnBridge();
  return null;
}
