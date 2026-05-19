'use client';

import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PlannerAlternativeResponseDto } from '@tripick/types';

import { fetchPlannerAlternatives, swapPlannerItem } from '@/entities/trip-plan';
import { queryKeys } from '@/shared/api/query-keys';

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: PlannerAlternativeResponseDto };

export function useAlternativeController(tripId: string, itemId: string | null) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [appliedName, setAppliedName] = useState<string | null>(null);
  const alternativesQuery = useQuery({
    queryKey: queryKeys.planner.alternatives(tripId, itemId ?? 'pending'),
    queryFn: () => {
      if (!itemId) {
        throw new Error('일정 항목을 먼저 선택해주세요.');
      }
      return fetchPlannerAlternatives(tripId, itemId);
    },
    enabled: Boolean(itemId),
    staleTime: 2 * 60 * 1000,
  });

  useEffect(() => {
    if (!itemId) {
      setSelectedId(null);
      setAppliedName(null);
      return;
    }
    if (alternativesQuery.data) {
      setSelectedId(alternativesQuery.data.alternatives[0]?.id ?? null);
      setAppliedName(null);
    }
  }, [itemId, alternativesQuery.data]);

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!itemId || !selectedId) {
        return null;
      }
      return swapPlannerItem(tripId, {
        itemId,
        alternativeId: selectedId,
      });
    },
    onSuccess: async (result) => {
      if (!result) {
        return;
      }
      setAppliedName(result.newItemName);
      await queryClient.invalidateQueries({ queryKey: queryKeys.planner.trip(tripId) });
    },
  });

  const state: State = !itemId
    ? { status: 'idle' }
    : alternativesQuery.isPending
      ? { status: 'loading' }
      : alternativesQuery.error instanceof Error
        ? { status: 'error', message: alternativesQuery.error.message }
        : alternativesQuery.data
          ? { status: 'ready', data: alternativesQuery.data }
          : { status: 'loading' };

  const apply = useCallback(async () => {
    if (!itemId || !selectedId || applyMutation.isPending) return null;
    return applyMutation.mutateAsync();
  }, [applyMutation, itemId, selectedId]);

  return {
    state,
    selectedId,
    setSelectedId,
    apply,
    submitting: applyMutation.isPending,
    appliedName,
  };
}
