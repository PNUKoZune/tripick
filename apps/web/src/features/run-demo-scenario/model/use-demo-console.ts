'use client';

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
 * 콘솔이 꺼진 서버에서는 상태 조회가 404 로 떨어진다 — 재시도하면 무대에서 버튼이 먹통인
 * 채로 기다리게 되므로 재시도하지 않고 화면이 바로 안내를 띄우게 한다.
 */
export function useDemoConsole() {
  const queryClient = useQueryClient();
  const invalidateStatus = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.demoConsole.status });

  const status = useQuery<DemoConsoleStatusDto>({
    queryKey: queryKeys.demoConsole.status,
    queryFn: fetchDemoStatus,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const seed = useMutation<DemoTripSummaryDto, Error, void>({
    mutationFn: () => seedDemoTrip(),
    onSuccess: invalidateStatus,
  });

  const scenario = useMutation<DemoScenarioResultDto, Error, DemoScenario>({
    mutationFn: (name) => runDemoScenario(name),
    // 시나리오는 위치·일정 시각을 바꾸므로 상태 카드도 함께 갱신한다.
    onSuccess: invalidateStatus,
  });

  const reset = useMutation<DemoConsoleStatusDto, Error, void>({
    mutationFn: () => resetDemoState(),
    onSuccess: (next) => {
      queryClient.setQueryData(queryKeys.demoConsole.status, next);
    },
  });

  return { status, seed, scenario, reset };
}
