'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ActiveReplanDto, ReplanResultDto, ReplanStatus } from '@tripick/types';

import { fetchActiveReplan } from '@/entities/trip-plan';
import { queryKeys } from '@/shared/api/query-keys';
import { getRealtimeSocket } from '@/shared/realtime';

/** `join-trip` emit 에 대한 서버 ack 응답 */
interface JoinAck {
  event: 'joined' | 'join-denied';
  tripId: string;
}

/** 토스트·진행 핀이 보여 줄 재계획 상태 */
export interface ReplanStatusView {
  jobId: string;
  status: ReplanStatus;
  explanation?: string;
  /** 새 잡이 아니라 이미 도는 재계획에 합쳐진 요청 (이번 입력은 반영되지 않음) */
  deduped?: boolean;
  /** 진행 중일 때 다시 짜는 일차(1-based). 생략이면 전체 일정 */
  targetDays?: number[];
}

/**
 * 특정 여행의 실시간 재계획(replan) 상태를 구독한다.
 *
 * - 진행 중: 서버의 대기·실행 중 잡 조회(`replan.active` 캐시)가 정본. 요청 성공 시
 *   useRequestReplan 이 캐시를 바로 채우고, 워커의 `processing` 신호·소켓 재연결 때 다시 조회한다.
 *   그래서 요청 뒤에 연 화면(플래너 → Live 이동, 새로고침, 다른 멤버)도 "다시 짜는 중" 을 본다.
 * - 결과: `trip-session:{tripId}` 룸의 `replan_result`. 완료면 planner trip 캐시를 무효화한다.
 * - 가장 최근 상태/접근 거부 여부를 반환해 UI 알림에 사용
 */
export function useReplanSubscription(tripId: string) {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<ReplanResultDto | null>(null);
  const [dismissedJobId, setDismissedJobId] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  // 결과가 온 잡. 워커는 결과를 보낸 뒤에야 잡을 끝내므로, 그 사이 조회는 끝난 잡을
  // "실행 중" 으로 돌려준다 — 그 응답에 진행 토스트가 되살아나지 않게 거른다.
  const [finishedJobIds, setFinishedJobIds] = useState<ReadonlySet<string>>(() => new Set());

  // 여행이 바뀌면 이전 여행의 결과·닫힘 상태를 버린다 (effect 대신 렌더 단계 조정).
  const [prevTripId, setPrevTripId] = useState(tripId);
  if (prevTripId !== tripId) {
    setPrevTripId(tripId);
    setResult(null);
    setDismissedJobId(null);
  }

  const activeKey = queryKeys.replan.active(tripId);
  const { data: activeData } = useQuery({
    queryKey: activeKey,
    queryFn: () => fetchActiveReplan(tripId),
    enabled: Boolean(tripId),
    // 화면을 열 때마다 다시 확인한다 — 다른 화면에서 건 재계획을 이어받아야 한다.
    staleTime: 0,
  });
  const activeJob =
    activeData?.job && !finishedJobIds.has(activeData.job.jobId) ? activeData.job : null;

  useEffect(() => {
    if (!tripId) return;

    let active = true;
    let unsubscribe = () => {};
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 소켓 재구독 시작 시 거부 상태 리셋
    setAccessDenied(false);

    void getRealtimeSocket()
      .then((socket) => {
        if (!active) return;

        let joinedBefore = false;
        // join 시 서버가 멤버십을 확인해 joined / join-denied 를 ack 로 돌려준다
        const joinTrip = () => {
          // 재연결이면 끊긴 사이 결과를 놓쳤을 수 있다 — 진행 상태와 일정을 다시 맞춘다.
          if (joinedBefore) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.replan.active(tripId) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.planner.trip(tripId) });
          }
          joinedBefore = true;
          socket.emit('join-trip', { tripId }, (ack?: JoinAck) => {
            if (!active || !ack || ack.tripId !== tripId) return;
            setAccessDenied(ack.event === 'join-denied');
          });
        };

        // 이미 연결돼 있으면 즉시 join, 재연결 시에도 다시 join
        if (socket.connected) joinTrip();
        socket.on('connect', joinTrip);

        const handleReplanResult = (next: ReplanResultDto) => {
          if (!active || next.tripId !== tripId) return;

          // 실행 시작(재시도 포함). 다른 멤버가 건 잡일 수 있어 조회로 정본을 받는다.
          if (next.status === 'pending' || next.status === 'processing') {
            void queryClient.invalidateQueries({ queryKey: queryKeys.replan.active(tripId) });
            return;
          }

          setFinishedJobIds((prev) => new Set(prev).add(next.jobId));
          queryClient.setQueryData<ActiveReplanDto>(queryKeys.replan.active(tripId), (prev) =>
            prev?.job?.jobId === next.jobId ? { job: null } : prev,
          );

          if (next.status === 'completed') {
            void queryClient.invalidateQueries({ queryKey: queryKeys.planner.trip(tripId) });
            void queryClient.invalidateQueries({
              queryKey: queryKeys.planner.coordination(tripId),
            });
          }

          setResult(next);
        };

        socket.on('replan_result', handleReplanResult);
        unsubscribe = () => {
          socket.off('connect', joinTrip);
          socket.off('replan_result', handleReplanResult);
        };
      })
      .catch((error) => {
        if (active && error instanceof Error && error.name !== 'AbortError') {
          console.warn('[realtime] 재계획 구독 연결 실패:', error);
        }
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [tripId, queryClient]);

  // 진행 중인 잡이 있으면 그쪽이 우선 — 새로 건 재계획이 지난 결과 토스트에 가리지 않게.
  const showingActive = activeJob && activeJob.jobId !== dismissedJobId ? activeJob : null;
  const latest: ReplanStatusView | null = showingActive
    ? {
        jobId: showingActive.jobId,
        status: showingActive.status,
        ...(showingActive.deduped ? { deduped: true } : {}),
        ...(showingActive.targetDays?.length ? { targetDays: showingActive.targetDays } : {}),
      }
    : result;

  const dismiss = useCallback(() => {
    if (showingActive) setDismissedJobId(showingActive.jobId);
    else setResult(null);
  }, [showingActive]);

  return { latest, dismiss, accessDenied };
}
