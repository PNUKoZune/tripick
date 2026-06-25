'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ReplanResultDto } from '@tripick/types';

import { queryKeys } from '@/shared/api/query-keys';
import { getRealtimeSocket } from '@/shared/realtime';

/** `join-trip` emit 에 대한 서버 ack 응답 */
interface JoinAck {
  event: 'joined' | 'join-denied';
  tripId: string;
}

/**
 * 특정 여행의 실시간 재계획(replan) 결과를 구독한다.
 *
 * - 마운트 시 `trip-session:{tripId}` 룸에 join (ack 로 권한 거부 여부 수신)
 * - `replan_result` 수신 → 완료된 경우 planner trip 캐시를 무효화해 최신 일정으로 갱신
 * - 가장 최근 결과/접근 거부 여부를 반환해 UI 알림에 사용
 */
export function useReplanSubscription(tripId: string) {
  const queryClient = useQueryClient();
  const [latest, setLatest] = useState<ReplanResultDto | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);

  useEffect(() => {
    if (!tripId) return;

    let active = true;
    const socket = getRealtimeSocket();
    setAccessDenied(false);

    // join 시 서버가 멤버십을 확인해 joined / join-denied 를 ack 로 돌려준다
    const joinTrip = () => {
      socket.emit('join-trip', { tripId }, (ack?: JoinAck) => {
        if (!active || !ack || ack.tripId !== tripId) return;
        setAccessDenied(ack.event === 'join-denied');
      });
    };

    // 이미 연결돼 있으면 즉시 join, 재연결 시에도 다시 join
    if (socket.connected) joinTrip();
    socket.on('connect', joinTrip);

    const handleReplanResult = (result: ReplanResultDto) => {
      if (!active || result.tripId !== tripId) return;

      if (result.status === 'completed') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.planner.trip(tripId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.planner.coordination(tripId) });
      }

      setLatest(result);
    };

    socket.on('replan_result', handleReplanResult);

    return () => {
      active = false;
      socket.off('connect', joinTrip);
      socket.off('replan_result', handleReplanResult);
    };
  }, [tripId, queryClient]);

  return { latest, dismiss: () => setLatest(null), accessDenied };
}
