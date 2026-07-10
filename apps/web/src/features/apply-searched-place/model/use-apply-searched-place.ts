'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PlannerSwapResponseDto } from '@tripick/types';

import { swapPlannerItem } from '@/entities/trip-plan';
import { queryKeys } from '@/shared/api/query-keys';

/** 지도 검색으로 고른 장소 (카카오 Places 결과에서 추출) */
export type SearchedPlace = {
  name: string;
  address: string;
  lat: number;
  lng: number;
};

/**
 * 지도에서 검색해 고른 장소를 선택된 일정 항목에 반영(swap)한다.
 * 카테고리는 넘기지 않아 기존 항목의 타입(관광/식사 등)을 유지한다.
 */
export function useApplySearchedPlace(tripId: string) {
  const queryClient = useQueryClient();
  return useMutation<PlannerSwapResponseDto, Error, { itemId: string; place: SearchedPlace }>({
    mutationFn: ({ itemId, place }) =>
      swapPlannerItem(tripId, {
        itemId,
        place: {
          name: place.name,
          address: place.address,
          lat: place.lat,
          lng: place.lng,
        },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.planner.trip(tripId) }),
  });
}
