'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  ReplanJobDto,
  ReplanRequestDto,
  ReplanTrigger,
  ScheduleChangeProposalDto,
} from '@tripick/types';

import { requestTripReplan } from '@/entities/trip-plan';
import { createScheduleChange } from '@/entities/schedule-change';
import { queryKeys } from '@/shared/api/query-keys';

export type ReplanFormPayload = Omit<ReplanRequestDto, 'tripId' | 'trigger'>;

type Options = {
  /** owner 면 즉시 재계획, 아니면 owner 승인 대기 제안으로 보낸다 */
  isOwner?: boolean;
  /**
   * 재계획 트리거. 기본 'manual'(사용자 직접 요청).
   * 알림 딥링크에서 열린 경우 weather·crowd·deviation 로 넘어와 검색·프롬프트에 맥락으로 반영된다.
   */
  trigger?: ReplanTrigger;
  onProposed?: (summary: string) => void;
};

type ReplanResult = ReplanJobDto | ScheduleChangeProposalDto;

/**
 * 전체 일정 재계획 요청.
 * - owner: 요청 트리거(기본 manual, 알림 배너에서 열리면 weather·crowd·deviation)로
 *   즉시 BullMQ 잡 등록(결과는 WS 로 반영).
 * - 비-owner 참여자: owner 승인 대기 제안으로 보낸다(승인 시 owner 권한으로 재계획 실행).
 */
export function useRequestReplan(tripId: string, options: Options = {}) {
  const { isOwner = true, trigger = 'manual', onProposed } = options;
  const queryClient = useQueryClient();

  return useMutation<ReplanResult, Error, ReplanFormPayload>({
    mutationFn: (payload) =>
      isOwner
        ? requestTripReplan({ tripId, trigger, ...payload })
        : createScheduleChange({
            tripId,
            payload: { kind: 'replan', body: { trigger, ...payload } },
          }),
    onSuccess: (result) => {
      if (!isOwner) {
        queryClient.invalidateQueries({ queryKey: queryKeys.scheduleChanges.list(tripId) });
        onProposed?.((result as ScheduleChangeProposalDto).summary);
      }
    },
  });
}
