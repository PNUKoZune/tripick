'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  approveScheduleChange,
  cancelScheduleChange,
  rejectScheduleChange,
} from '@/entities/schedule-change';
import { queryKeys } from '@/shared/api/query-keys';

/**
 * 일정 변경 제안 처리 뮤테이션.
 * - approve/reject: owner 전용
 * - cancel: 요청자 본인
 * 성공 시 제안 목록·인박스를 무효화하고, 승인은 일정(planner.trip)도 최신화한다.
 */
export function useScheduleChangeActions(tripId: string) {
  const queryClient = useQueryClient();

  const invalidateCommon = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.scheduleChanges.list(tripId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.inbox.list });
  };

  const approve = useMutation({
    mutationFn: (id: string) => approveScheduleChange(id),
    onSuccess: () => {
      invalidateCommon();
      queryClient.invalidateQueries({ queryKey: queryKeys.planner.trip(tripId) });
    },
  });

  const reject = useMutation({
    mutationFn: (id: string) => rejectScheduleChange(id),
    onSuccess: invalidateCommon,
  });

  const cancel = useMutation({
    mutationFn: (id: string) => cancelScheduleChange(id),
    onSuccess: invalidateCommon,
  });

  return { approve, reject, cancel };
}
