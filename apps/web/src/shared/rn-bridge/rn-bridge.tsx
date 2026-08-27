'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { updateFcmToken } from '@/entities/user';
import { getStoredSession } from '@/entities/session/model/session-storage';
import { getReactNativeWebView } from '@/shared/rn-bridge/rn-webview';
import { isTrustedBridgeOrigin } from '@/shared/rn-bridge/bridge-origin';
import { isNativeShell } from '@/shared/rn-bridge/native-refresh-token';
import { setNativeAppVersion } from '@/shared/rn-bridge/native-app-version';
import { persistSession } from '@/shared/lib/session-token';
import { queryKeys } from '@/shared/api/query-keys';
import { routeForNotification } from '@/shared/web-push/route';
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
  | { type: 'LOCATION_ERROR'; code: number; message: string }
  | { type: 'APP_VERSION'; version: string };

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
      // 다른 창·프레임이 보낸 메시지는 버린다 — 이 검사가 없으면 우리를 iframe 으로 띄운
      // 페이지가 FCM_TOKEN 을 던져 피해자 계정에 자기 기기 토큰을 등록시킬 수 있었다.
      if (!isTrustedBridgeOrigin(event)) return;
      // RN postMessage 는 string. 다른 포맷의 메시지는 무시.
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

      if (msg.type === 'APP_VERSION' && msg.version) {
        // 설정 "버전" 이 웹 빌드 버전 대신 설치된 앱 버전을 보여주게 한다.
        setNativeAppVersion(msg.version);
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

    // 업그레이드 이관: 이 변경 이전 빌드가 localStorage 에 남긴 refresh 토큰을
    // 네이티브 SecureStore 로 옮기고 localStorage 에선 지운다(1회성, 이후엔 항상 stripped 저장).
    if (isNativeShell()) {
      const session = getStoredSession();
      if (session?.tokens?.refreshToken) persistSession(session);
    }

    window.addEventListener('message', handle);
    // 리스너를 붙인 직후 RN 에 알린다 — 종료 상태 푸시 탭으로 켜졌을 때 RN 이 보관한
    // NOTIFICATION_TAP 을 이 시점에 flush 해야 유실 없이 라우팅된다.
    getReactNativeWebView()?.postMessage(JSON.stringify({ type: 'WEB_READY' }));

    return () => window.removeEventListener('message', handle);
  }, [queryClient, router]);
}

export function RnBridge() {
  useRnBridge();
  return null;
}
