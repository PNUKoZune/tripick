'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchInbox } from '@/entities/inbox';
import { useHasSession } from '@/entities/session';
import { queryKeys } from '@/shared/api/query-keys';
import { getRealtimeSocket } from '@/shared/realtime';

/**
 * 앱 전역 인박스 미읽음 수. nav 배지가 어느 페이지에서도 실시간으로 갱신되게 한다.
 *
 * - 세션 게이팅: 로그인 전이면 소켓·쿼리를 건드리지 않는다([useActiveTrip] 패턴).
 * - `inbox_invalidate` 수신 시 목록 쿼리를 무효화 → 미읽음 수 재계산.
 *   (inbox-view 의 구독은 그 페이지 한정이라 다른 페이지 배지엔 닿지 않으므로 여기서 별도 구독)
 * - 쿼리 키가 inbox-view 와 동일해 캐시를 공유한다(중복 fetch 없음).
 */
export function useInboxUnread(): number {
  const hasSession = useHasSession();

  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: queryKeys.inbox.list,
    queryFn: fetchInbox,
    enabled: hasSession,
    staleTime: 60 * 1000,
  });

  useEffect(() => {
    if (!hasSession) return;
    const socket = getRealtimeSocket();
    const handleInvalidate = () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.inbox.list });
    };
    socket.on('inbox_invalidate', handleInvalidate);
    return () => {
      socket.off('inbox_invalidate', handleInvalidate);
    };
  }, [hasSession, queryClient]);

  return data?.unreadCount ?? 0;
}
