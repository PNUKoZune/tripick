'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  PlannerAddItemRequestDto,
  PlannerReorderItemsRequestDto,
  PlannerUpdateItemRequestDto,
} from '@tripick/types';

import {
  addItineraryItem,
  deleteItineraryItem,
  reorderItineraryItems,
  updateItineraryItem,
} from '@/entities/trip-plan';
import { queryKeys } from '@/shared/api/query-keys';

/**
 * 일정 항목 수동 편집(추가/수정/삭제/순서변경) 뮤테이션 묶음.
 * 성공 시 planner.trip 쿼리를 무효화해 지도·마커·순서를 최신화한다.
 */
export function useItineraryItems(tripId: string) {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.planner.trip(tripId) });

  const addItem = useMutation({
    mutationFn: (body: PlannerAddItemRequestDto) => addItineraryItem(tripId, body),
    onSuccess: invalidate,
  });

  const updateItem = useMutation({
    mutationFn: ({ itemId, body }: { itemId: string; body: PlannerUpdateItemRequestDto }) =>
      updateItineraryItem(tripId, itemId, body),
    onSuccess: invalidate,
  });

  const deleteItem = useMutation({
    mutationFn: (itemId: string) => deleteItineraryItem(tripId, itemId),
    onSuccess: invalidate,
  });

  const reorderItems = useMutation({
    mutationFn: (body: PlannerReorderItemsRequestDto) => reorderItineraryItems(tripId, body),
    onSuccess: invalidate,
  });

  return { addItem, updateItem, deleteItem, reorderItems };
}
