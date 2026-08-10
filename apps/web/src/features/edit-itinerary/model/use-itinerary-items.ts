'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  PlannerAddItemRequestDto,
  PlannerItineraryItemDto,
  PlannerReorderItemsRequestDto,
  PlannerUpdateItemRequestDto,
  ScheduleChangeProposalDto,
} from '@tripick/types';

import {
  addItineraryItem,
  deleteItineraryItem,
  reorderItineraryItems,
  updateItineraryItem,
} from '@/entities/trip-plan';
import { createScheduleChange } from '@/entities/schedule-change';
import { queryKeys } from '@/shared/api/query-keys';

type Options = {
  /** owner 면 즉시 반영, 아니면 owner 승인 대기(제안)로 보낸다 */
  isOwner?: boolean;
  /** 제안(비-owner) 성공 시 요약을 넘겨 토스트 등에 쓴다 */
  onProposed?: (summary: string) => void;
};

/**
 * 일정 항목 수동 편집(추가/수정/삭제/순서변경) 뮤테이션 묶음.
 * - owner: 기존처럼 즉시 반영하고 planner.trip 쿼리를 무효화한다.
 * - 비-owner 참여자: 변경을 즉시 반영하지 않고 owner 승인 대기 제안으로 보낸다.
 */
export function useItineraryItems(tripId: string, options: Options = {}) {
  const { isOwner = true, onProposed } = options;
  const queryClient = useQueryClient();
  const invalidateTrip = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.planner.trip(tripId) });
  const invalidateProposals = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.scheduleChanges.list(tripId) });

  const onProposeSuccess = (proposal: ScheduleChangeProposalDto) => {
    invalidateProposals();
    onProposed?.(proposal.summary);
  };

  const addItem = useMutation<
    PlannerItineraryItemDto | ScheduleChangeProposalDto,
    Error,
    PlannerAddItemRequestDto
  >({
    mutationFn: (body) =>
      isOwner
        ? addItineraryItem(tripId, body)
        : createScheduleChange({ tripId, payload: { kind: 'add_item', body } }),
    onSuccess: (result) =>
      isOwner ? invalidateTrip() : onProposeSuccess(result as ScheduleChangeProposalDto),
  });

  const updateItem = useMutation<
    PlannerItineraryItemDto | ScheduleChangeProposalDto,
    Error,
    { itemId: string; body: PlannerUpdateItemRequestDto }
  >({
    mutationFn: ({ itemId, body }) =>
      isOwner
        ? updateItineraryItem(tripId, itemId, body)
        : createScheduleChange({ tripId, payload: { kind: 'update_item', itemId, body } }),
    onSuccess: (result) =>
      isOwner ? invalidateTrip() : onProposeSuccess(result as ScheduleChangeProposalDto),
  });

  const deleteItem = useMutation<void | ScheduleChangeProposalDto, Error, string>({
    mutationFn: (itemId) =>
      isOwner
        ? deleteItineraryItem(tripId, itemId)
        : createScheduleChange({ tripId, payload: { kind: 'delete_item', itemId } }),
    onSuccess: (result) =>
      isOwner ? invalidateTrip() : onProposeSuccess(result as ScheduleChangeProposalDto),
  });

  const reorderItems = useMutation<
    void | ScheduleChangeProposalDto,
    Error,
    PlannerReorderItemsRequestDto
  >({
    mutationFn: (body) =>
      isOwner
        ? reorderItineraryItems(tripId, body)
        : createScheduleChange({ tripId, payload: { kind: 'reorder_items', body } }),
    onSuccess: (result) =>
      isOwner ? invalidateTrip() : onProposeSuccess(result as ScheduleChangeProposalDto),
  });

  return { addItem, updateItem, deleteItem, reorderItems, isProposalMode: !isOwner };
}
