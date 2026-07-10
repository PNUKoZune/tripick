'use client';

import { useMutation } from '@tanstack/react-query';
import type { ReplanJobDto, ReplanRequestDto } from '@tripick/types';

import { requestTripReplan } from '@/entities/trip-plan';

export type ReplanFormPayload = Omit<ReplanRequestDto, 'tripId' | 'trigger'>;

/** 전체 일정 재계획 요청 (manual 트리거 → BullMQ 잡 등록, 결과는 WS 로 반영) */
export function useRequestReplan(tripId: string) {
  return useMutation<ReplanJobDto, Error, ReplanFormPayload>({
    mutationFn: (payload) => requestTripReplan({ tripId, trigger: 'manual', ...payload }),
  });
}
