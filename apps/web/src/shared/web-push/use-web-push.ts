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
} from '@/shared/rn-bridge/fcm-token-storage';
import { onForegroundPush, requestWebPushToken } from './messaging';
import { routeForNotification } from './route';

/**
 * 브라우저 단독 사용자용 웹 푸시 배선. RN 컨테이너 밖에서만 동작하며(내부 가드는 messaging 에서),
 * RN 브릿지(rn-bridge.tsx)의 FCM_TOKEN 흐름을 웹 SDK 로 대응시킨 것:
 * - 토큰 발급 → 세션 있으면 백엔드 등록(platform='web'), 없으면 pending 보관(로그인 시 flush)
 * - 포그라운드 수신 → 인박스 invalidate
 * - SW 알림 클릭(NOTIFICATION_TAP) → 인박스 invalidate + 해당 화면 라우팅
 *
 * 저장소(pending/last 토큰)를 RN 과 공유하므로 로그아웃 시 deleteFcmToken 흐름이 그대로 해제한다.
 */
export function useWebPush() {
  const queryClient = useQueryClient();
  const router = useRouter();

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      const token = await requestWebPushToken();
      if (cancelled || !token) return;

      if (!getStoredSession()) {
        // 로그인 전 — 보관해뒀다가 로그인 완료 시 flushPendingFcmToken 이 등록한다.
        setPendingFcmToken(token);
      } else if (getLastFcmToken() !== token) {
        try {
          await updateFcmToken(token, 'web');
          setLastFcmToken(token);
          clearPendingFcmToken();
        } catch (err) {
          console.warn('[web-push] fcm-token 등록 실패:', err);
        }
      }

      unsubscribe = await onForegroundPush(() => {
        queryClient.invalidateQueries({ queryKey: queryKeys.inbox.list });
      });
    })();

    // SW 가 알림 클릭 시 열린 탭으로 보내는 메시지 수신(navigator.serviceWorker 채널).
    function handleSwMessage(event: MessageEvent) {
      const msg = event.data;
      if (!msg || msg.type !== 'NOTIFICATION_TAP') return;
      queryClient.invalidateQueries({ queryKey: queryKeys.inbox.list });
      const route = routeForNotification(msg.data);
      if (route) router.push(route);
    }
    navigator.serviceWorker?.addEventListener('message', handleSwMessage);

    return () => {
      cancelled = true;
      unsubscribe?.();
      navigator.serviceWorker?.removeEventListener('message', handleSwMessage);
    };
  }, [queryClient, router]);
}
