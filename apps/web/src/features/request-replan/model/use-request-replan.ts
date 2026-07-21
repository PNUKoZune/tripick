'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  ReplanJobDto,
  ReplanRequestDto,
  ScheduleChangeProposalDto,
} from '@tripick/types';

import { requestTripReplan } from '@/entities/trip-plan';
import { createScheduleChange } from '@/entities/schedule-change';
import { queryKeys } from '@/shared/api/query-keys';

export type ReplanFormPayload = Omit<ReplanRequestDto, 'tripId' | 'trigger'>;

type Options = {
  /** owner 면 즉시 재계획, 아니면 owner 승인 대기 제안으로 보낸다 */
  isOwner?: boolean;
  onProposed?: (summary: string) => void;
};

type ReplanResult = ReplanJobDto | ScheduleChangeProposalDto;

/**
 * 전체 일정 재계획 요청.
 * - owner: manual 트리거로 즉시 BullMQ 잡 등록(결과는 WS 로 반영).
 * - 비-owner 참여자: owner 승인 대기 제안으로 보낸다(승인 시 owner 권한으로 재계획 실행).
 */
export function useRequestReplan(tripId: string, options: Options = {}) {
  const { isOwner = true, onProposed } = options;
  const queryClient = useQueryClient();

  return useMutation<ReplanResult, Error, ReplanFormPayload>({
    mutationFn: (payload) =>
      isOwner
        ? requestTripReplan({ tripId, trigger: 'manual', ...payload })
        : createScheduleChange({
            tripId,
            payload: { kind: 'replan', body: { trigger: 'manual', ...payload } },
          }),
    onSuccess: (result) => {
      if (!isOwner) {
        queryClient.invalidateQueries({ queryKey: queryKeys.scheduleChanges.list(tripId) });
        onProposed?.((result as ScheduleChangeProposalDto).summary);
      }
    },
  });
}
