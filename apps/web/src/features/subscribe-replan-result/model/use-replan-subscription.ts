'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ReplanResultDto } from '@tripick/types';

import { queryKeys } from '@/shared/api/query-keys';
import { getRealtimeSocket } from '@/shared/realtime';

/**
 * 특정 여행의 실시간 재계획(replan) 결과를 구독한다.
 *
 * - 마운트 시 `trip-session:{tripId}` 룸에 join
 * - `replan_result` 수신 → 완료된 경우 planner trip 캐시를 무효화해 최신 일정으로 갱신
 * - 가장 최근 결과를 반환해 토스트 등 UI 알림에 사용
 */
export function useReplanSubscription(tripId: string) {
  const queryClient = useQueryClient();
  const [latest, setLatest] = useState<ReplanResultDto | null>(null);

  useEffect(() => {
    if (!tripId) return;

    const socket = getRealtimeSocket();
    const joinTrip = () => socket.emit('join-trip', { tripId });

    // 이미 연결돼 있으면 즉시 join, 재연결 시에도 다시 join
    if (socket.connected) joinTrip();
    socket.on('connect', joinTrip);

    const handleReplanResult = (result: ReplanResultDto) => {
      if (result.tripId !== tripId) return;

      if (result.status === 'completed') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.planner.trip(tripId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.planner.coordination(tripId) });
      }

      setLatest(result);
    };

    socket.on('replan_result', handleReplanResult);

    return () => {
      socket.off('connect', joinTrip);
      socket.off('replan_result', handleReplanResult);
    };
  }, [tripId, queryClient]);

  return { latest, dismiss: () => setLatest(null) };
}
