'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PlannerAlternativeDto,
  PlannerAlternativeResponseDto,
  PlannerSwapPlaceDto,
} from '@tripick/types';

import { fetchPlannerAlternatives, resolvePlannerLink, swapPlannerItem } from '@/entities/trip-plan';
import { queryKeys } from '@/shared/api/query-keys';

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: PlannerAlternativeResponseDto };

function toSwapPlace(alt: PlannerAlternativeDto): PlannerSwapPlaceDto {
  return {
    name: alt.name,
    category: alt.category,
    lat: alt.lat,
    lng: alt.lng,
    mapHref: alt.mapHref,
    ...(alt.address ? { address: alt.address } : {}),
  };
}

export function useAlternativeController(tripId: string, itemId: string | null) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [appliedName, setAppliedName] = useState<string | null>(null);
  // 사용자가 확정한 자유 텍스트 요청 (예: "조용한 감성 카페"). '' 이면 기본 추천.
  const [query, setQuery] = useState('');
  // 지도 링크로 해석해 추가한 대안들 (기본 목록 위에 얹힘)
  const [linkedAlternatives, setLinkedAlternatives] = useState<PlannerAlternativeDto[]>([]);

  const alternativesQuery = useQuery({
    queryKey: queryKeys.planner.alternatives(tripId, itemId ?? 'pending', query),
    queryFn: () => {
      if (!itemId) {
        throw new Error('일정 항목을 먼저 선택해주세요.');
      }
      return fetchPlannerAlternatives(tripId, itemId, query);
    },
    enabled: Boolean(itemId),
    staleTime: 2 * 60 * 1000,
  });

  // itemId 가 바뀌면 로컬 상태 초기화
  useEffect(() => {
    setQuery('');
    setLinkedAlternatives([]);
    setSelectedId(null);
    setAppliedName(null);
  }, [itemId]);

  const alternatives = useMemo<PlannerAlternativeDto[]>(() => {
    const base = alternativesQuery.data?.alternatives ?? [];
    return [...linkedAlternatives, ...base];
  }, [alternativesQuery.data, linkedAlternatives]);

  // 목록이 채워지면 첫 항목을 기본 선택
  useEffect(() => {
    if (!itemId) return;
    if (alternatives.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((current) =>
      current && alternatives.some((alt) => alt.id === current) ? current : alternatives[0]!.id,
    );
  }, [itemId, alternatives]);

  const resolveLinkMutation = useMutation({
    mutationFn: (url: string) => {
      if (!itemId) throw new Error('일정 항목을 먼저 선택해주세요.');
      return resolvePlannerLink(tripId, itemId, url);
    },
    onSuccess: (result) => {
      setLinkedAlternatives((prev) => {
        const next = prev.filter((alt) => alt.id !== result.alternative.id);
        return [result.alternative, ...next];
      });
      setSelectedId(result.alternative.id);
      setAppliedName(null);
    },
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!itemId || !selectedId) return null;
      const selected = alternatives.find((alt) => alt.id === selectedId);
      if (!selected) return null;
      return swapPlannerItem(tripId, {
        itemId,
        place: toSwapPlace(selected),
      });
    },
    onSuccess: async (result) => {
      if (!result) return;
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

  const submitSearch = useCallback((text: string) => {
    setQuery(text.trim());
  }, []);

  const resolveLink = useCallback(
    async (url: string): Promise<boolean> => {
      if (!url.trim() || resolveLinkMutation.isPending) return false;
      resolveLinkMutation.reset();
      const result = await resolveLinkMutation.mutateAsync(url.trim()).catch(() => null);
      return Boolean(result);
    },
    [resolveLinkMutation],
  );

  const apply = useCallback(async () => {
    if (!itemId || !selectedId || applyMutation.isPending) return null;
    return applyMutation.mutateAsync();
  }, [applyMutation, itemId, selectedId]);

  return {
    state,
    alternatives,
    selectedId,
    setSelectedId,
    query,
    submitSearch,
    searching: alternativesQuery.isFetching && Boolean(query),
    resolveLink,
    resolving: resolveLinkMutation.isPending,
    resolveError:
      resolveLinkMutation.error instanceof Error ? resolveLinkMutation.error.message : null,
    apply,
    submitting: applyMutation.isPending,
    appliedName,
  };
}
