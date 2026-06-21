'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { updateFcmToken } from '@/entities/user';
import { getStoredSession } from '@/entities/session/model/session-storage';
import { queryKeys } from '@/shared/api/query-keys';

type RnBridgeMessage =
  | { type: 'FCM_TOKEN'; token: string }
  | { type: 'PUSH_NOTIFICATION'; data?: { data?: Record<string, string> } }
  | { type: 'LOCATION_UPDATE'; lat: number; lng: number; accuracy?: number; timestamp?: number }
  | { type: 'LOCATION_ERROR'; code: number; message: string };

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
        // 세션 없으면 등록할 데가 없음. 로그인 후 다시 토큰을 받게 RN 측에서 재전송하도록 후속에서 보강.
        if (!getStoredSession()) return;
        const last = sessionStorage.getItem(LAST_FCM_KEY);
        if (last === msg.token) return;
        updateFcmToken(msg.token)
          .then(() => sessionStorage.setItem(LAST_FCM_KEY, msg.token))
          .catch((err) => console.warn('[rn-bridge] fcm-token update failed:', err));
        return;
      }

      if (msg.type === 'PUSH_NOTIFICATION') {
        queryClient.invalidateQueries({ queryKey: queryKeys.inbox.list });
        return;
      }
    }

    window.addEventListener('message', handle);
    return () => window.removeEventListener('message', handle);
  }, [queryClient]);
}

const LAST_FCM_KEY = 'tripick.fcm.lastToken';

export function RnBridge() {
  useRnBridge();
  return null;
}
