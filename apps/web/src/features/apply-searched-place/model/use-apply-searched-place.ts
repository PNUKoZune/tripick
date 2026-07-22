'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PlannerSwapResponseDto, ScheduleChangeProposalDto } from '@tripick/types';

import { swapPlannerItem } from '@/entities/trip-plan';
import { createScheduleChange } from '@/entities/schedule-change';
import { queryKeys } from '@/shared/api/query-keys';

/** 지도 검색으로 고른 장소 (카카오 Places 결과에서 추출) */
export type SearchedPlace = {
  name: string;
  address: string;
  lat: number;
  lng: number;
  kakaoPlaceId?: string;
};

type ApplyResult = PlannerSwapResponseDto | ScheduleChangeProposalDto;

type Options = {
  /** owner 면 즉시 반영, 아니면 owner 승인 대기 제안으로 보낸다 */
  isOwner?: boolean;
  onProposed?: (summary: string) => void;
};

/**
 * 지도에서 검색해 고른 장소를 선택된 일정 항목에 반영(swap)한다.
 * 카테고리는 넘기지 않아 기존 항목의 타입(관광/식사 등)을 유지한다.
 * - owner: 즉시 swap 후 planner.trip 무효화.
 * - 비-owner 참여자: owner 승인 대기 제안으로 보낸다.
 */
export function useApplySearchedPlace(tripId: string, options: Options = {}) {
  const { isOwner = true, onProposed } = options;
  const queryClient = useQueryClient();
  return useMutation<ApplyResult, Error, { itemId: string; place: SearchedPlace }>({
    mutationFn: ({ itemId, place }) => {
      const swapPlace = {
        name: place.name,
        address: place.address,
        lat: place.lat,
        lng: place.lng,
        ...(place.kakaoPlaceId ? { kakaoPlaceId: place.kakaoPlaceId } : {}),
      };
      return isOwner
        ? swapPlannerItem(tripId, { itemId, place: swapPlace })
        : createScheduleChange({
            tripId,
            payload: { kind: 'swap', body: { itemId, place: swapPlace } },
          });
    },
    onSuccess: (result) => {
      if (isOwner) {
        return queryClient.invalidateQueries({ queryKey: queryKeys.planner.trip(tripId) });
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.scheduleChanges.list(tripId) });
      onProposed?.((result as ScheduleChangeProposalDto).summary);
      return undefined;
    },
  });
}
