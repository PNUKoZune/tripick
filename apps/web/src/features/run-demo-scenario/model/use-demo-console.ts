'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DemoConsoleStatusDto,
  DemoScenario,
  DemoScenarioResultDto,
  DemoTripSummaryDto,
} from '@tripick/types';

import {
  fetchDemoStatus,
  resetDemoState,
  runDemoScenario,
  seedDemoTrip,
} from '@/entities/demo-console';
import { queryKeys } from '@/shared/api/query-keys';

/**
 * 시연 콘솔 상태 조회 + 버튼 3종(시드·시나리오·초기화).
 *
 * 대상 여행·일차는 화면에서 고른다 — 시연용 시드뿐 아니라 그 자리에서 만든 여행에도 조건을
 * 걸 수 있어야 하기 때문이다. 고르지 않으면(null) 서버가 시드 여행 → 오늘 진행 중인 여행
 * 순으로 자동 선택한다.
 *
 * 콘솔이 꺼진 서버에서는 상태 조회가 404 로 떨어진다 — 재시도하면 무대에서 버튼이 먹통인
 * 채로 기다리게 되므로 재시도하지 않고 화면이 바로 안내를 띄우게 한다.
 */
export function useDemoConsole() {
  const queryClient = useQueryClient();
  const [tripId, setTripId] = useState<string | null>(null);
  const [day, setDay] = useState<number | null>(null);

  // 선택값은 시나리오 요청 본문이자 상태 조회 파라미터다(같은 대상을 보고 같은 대상에 건다).
  const target = {
    ...(tripId ? { tripId } : {}),
    ...(day ? { day } : {}),
  };

  const invalidateStatus = () =>
    queryClient.invalidateQueries({ queryKey: ['demo-console', 'status'] });

  const status = useQuery<DemoConsoleStatusDto>({
    queryKey: queryKeys.demoConsole.status(tripId ?? '', day ?? 0),
    queryFn: () => fetchDemoStatus(target),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const seed = useMutation<DemoTripSummaryDto, Error, void>({
    mutationFn: () => seedDemoTrip(),
    onSuccess: (trip) => {
      // 시드 직후엔 그 여행을 보고 있어야 한다 — 다른 여행을 고른 상태였다면 갈아 끼운다.
      setTripId(trip.tripId);
      setDay(trip.day);
      invalidateStatus();
    },
  });

  const scenario = useMutation<DemoScenarioResultDto, Error, DemoScenario>({
    mutationFn: (name) => runDemoScenario(name, target),
    // 시나리오는 위치·일정 시각을 바꾸므로 상태 카드도 함께 갱신한다.
    onSuccess: invalidateStatus,
  });

  const reset = useMutation<DemoConsoleStatusDto, Error, void>({
    // 보고 있는 여행의 흔적을 지운다 — 비우면 서버는 기본 대상(시드 여행)만 정리한다.
    mutationFn: () => resetDemoState(target),
    onSuccess: invalidateStatus,
  });

  return {
    status,
    seed,
    scenario,
    reset,
    selection: { tripId, day, setTripId, setDay },
  };
}
