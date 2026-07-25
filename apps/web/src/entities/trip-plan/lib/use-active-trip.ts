'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useHasSession } from '@/entities/session';
import { queryKeys } from '@/shared/api/query-keys';

import { fetchPlannerTrips } from '../api';
import { splitTripSchedule } from './select-active-trip';

/**
 * 진행 중(active)인 여행이 있는지 세션 기반으로 판단한다.
 * `ActiveTripFab`(전역 플로팅 버튼) 노출 조건과 동일한 로직을 공유해,
 * 이 FAB와 겹치는 UI가 존재 여부에 맞춰 위치를 조정할 수 있게 한다.
 */
export function useActiveTrip() {
  const hasSession = useHasSession();

  const { data: trips = [] } = useQuery({
    queryKey: queryKeys.planner.trips,
    queryFn: fetchPlannerTrips,
    enabled: hasSession,
    staleTime: 60 * 1000,
  });

  return useMemo(() => splitTripSchedule(trips), [trips]);
}
