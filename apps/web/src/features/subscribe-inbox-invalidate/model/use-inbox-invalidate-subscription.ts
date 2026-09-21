'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/shared/api/query-keys';
import { getRealtimeSocket } from '@/shared/realtime';

/**
 * 인박스 실시간 동기화 구독.
 *
 * 서버가 인증된 소켓을 `inbox:{userId}` room 에 자동 합류시키므로 join emit 은 없다.
 * 새 알림 발생 시 서버가 `inbox_invalidate` 를 쏘면 인박스 목록 쿼리를 무효화해
 * 다시 불러온다. 브라우저 단독(RN 밖) 사용자가 FCM 브릿지를 못 받는 공백을 메운다.
 */
export function useInboxInvalidateSubscription() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};

    void getRealtimeSocket()
      .then((socket) => {
        if (!active) return;
        const handleInvalidate = () => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.inbox.list });
        };

        socket.on('inbox_invalidate', handleInvalidate);
        unsubscribe = () => socket.off('inbox_invalidate', handleInvalidate);
      })
      .catch((error) => {
        if (active && error instanceof Error && error.name !== 'AbortError') {
          console.warn('[realtime] 인박스 동기화 연결 실패:', error);
        }
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [queryClient]);
}
