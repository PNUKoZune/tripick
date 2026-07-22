'use client';

import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/shared/api/query-keys';
import { fetchScheduleChange, fetchScheduleChanges } from './api';

/** 트립의 대기중 일정 변경 제안 목록 */
export function useScheduleChanges(tripId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.scheduleChanges.list(tripId),
    queryFn: () => fetchScheduleChanges(tripId),
    enabled: enabled && Boolean(tripId),
    staleTime: 30 * 1000,
  });
}

/** 제안 단건 (owner diff 미리보기) */
export function useScheduleChange(id: string | null) {
  return useQuery({
    queryKey: queryKeys.scheduleChanges.detail(id ?? 'pending'),
    queryFn: () => fetchScheduleChange(id!),
    enabled: Boolean(id),
    staleTime: 30 * 1000,
  });
}
