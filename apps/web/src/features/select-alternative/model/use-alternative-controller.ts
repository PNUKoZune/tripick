'use client';

import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PlannerAlternativeDto,
  PlannerAlternativeResponseDto,
  PlannerMapMarkerDto,
  PlannerSwapPlaceDto,
  PlannerSwapResponseDto,
  ScheduleChangeProposalDto,
} from '@tripick/types';

import {
  fetchPlannerAlternatives,
  resolvePlannerPlace,
  swapPlannerItem,
} from '@/entities/trip-plan';
import { createScheduleChange } from '@/entities/schedule-change';
import { queryKeys } from '@/shared/api/query-keys';

type SwapResult = PlannerSwapResponseDto | ScheduleChangeProposalDto;

type Options = {
  /** owner 면 즉시 반영, 아니면 owner 승인 대기 제안으로 보낸다 */
  isOwner?: boolean;
  onProposed?: (summary: string) => void;
};

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: PlannerAlternativeResponseDto };

/** 장소 이름 검색으로 찾은, 사용자 확인 대기 중인 후보들 */
type PendingCandidates = {
  alternatives: PlannerAlternativeDto[];
  markers: PlannerMapMarkerDto[];
};

function toSwapPlace(alt: PlannerAlternativeDto): PlannerSwapPlaceDto {
  return {
    name: alt.name,
    category: alt.category,
    lat: alt.lat,
    lng: alt.lng,
    mapHref: alt.mapHref,
    ...(alt.address ? { address: alt.address } : {}),
    ...(alt.kakaoPlaceId ? { kakaoPlaceId: alt.kakaoPlaceId } : {}),
  };
}

export function useAlternativeController(
  tripId: string,
  itemId: string | null,
  options: Options = {},
) {
  const { isOwner = true, onProposed } = options;
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [appliedName, setAppliedName] = useState<string | null>(null);
  // 장소 이름 검색으로 찾은 후보들 + 그 중 사용자가 고른 후보
  const [pending, setPending] = useState<PendingCandidates | null>(null);
  const [pendingSelectedId, setPendingSelectedId] = useState<string | null>(null);
  // 사용자가 확정한 조건 텍스트 (예: "조용한 감성 카페"). '' 이면 기본 추천.
  const [note, setNote] = useState('');

  const alternativesQuery = useQuery({
    queryKey: queryKeys.planner.alternatives(tripId, itemId ?? 'pending', note),
    queryFn: () => {
      if (!itemId) {
        throw new Error('일정 항목을 먼저 선택해주세요.');
      }
      return fetchPlannerAlternatives(tripId, itemId, note);
    },
    enabled: Boolean(itemId),
    staleTime: 2 * 60 * 1000,
    // note 변경(조건 재검색) 시 이전 결과를 유지해 시트가 스켈레톤으로 깜빡이지 않게 한다
    placeholderData: (prev) => prev,
  });

  // itemId 가 바뀌면 로컬 상태 초기화 (effect 대신 렌더 단계 조정).
  const [prevItemId, setPrevItemId] = useState(itemId);
  if (prevItemId !== itemId) {
    setPrevItemId(itemId);
    setPending(null);
    setPendingSelectedId(null);
    setSelectedId(null);
    setAppliedName(null);
    setNote('');
  }

  const alternatives = alternativesQuery.data?.alternatives ?? [];

  // 목록이 채워지면 첫 항목을 기본 선택. selectedId·후보 목록·서버 refetch 타이밍이
  // 얽혀 있어 렌더 단계 조정으로 옮기면 선택이 튈 수 있으므로 effect 로 유지한다.
  useEffect(() => {
    if (!itemId) return;
    if (alternatives.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 후보 없으면 선택 해제(외부 데이터 동기화)
      setSelectedId(null);
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 서버 후보 목록에 맞춰 기본 선택 동기화
    setSelectedId((current) =>
      current && alternatives.some((alt) => alt.id === current) ? current : alternatives[0]!.id,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, alternativesQuery.data]);

  const swapMutation = useMutation<SwapResult, Error, PlannerSwapPlaceDto>({
    mutationFn: (place: PlannerSwapPlaceDto) => {
      if (!itemId) throw new Error('일정 항목을 먼저 선택해주세요.');
      return isOwner
        ? swapPlannerItem(tripId, { itemId, place })
        : createScheduleChange({ tripId, payload: { kind: 'swap', body: { itemId, place } } });
    },
    onSuccess: async (result) => {
      if (isOwner) {
        setAppliedName((result as PlannerSwapResponseDto).newItemName);
        await queryClient.invalidateQueries({ queryKey: queryKeys.planner.trip(tripId) });
      } else {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.scheduleChanges.list(tripId),
        });
        onProposed?.((result as ScheduleChangeProposalDto).summary);
      }
    },
  });

  const searchPlaceMutation = useMutation({
    mutationFn: (name: string) => {
      if (!itemId) throw new Error('일정 항목을 먼저 선택해주세요.');
      return resolvePlannerPlace(tripId, itemId, name);
    },
    onSuccess: (result) => {
      setPending({ alternatives: result.alternatives, markers: result.mapMarkers });
      setPendingSelectedId(result.alternatives[0]?.id ?? null);
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

  const searchPlace = useCallback(
    async (name: string) => {
      if (!name.trim() || searchPlaceMutation.isPending) return;
      searchPlaceMutation.reset();
      await searchPlaceMutation.mutateAsync(name.trim()).catch(() => null);
    },
    [searchPlaceMutation],
  );

  const cancelPending = useCallback(() => {
    setPending(null);
    setPendingSelectedId(null);
    searchPlaceMutation.reset();
  }, [searchPlaceMutation]);

  // 조건 텍스트로 이 항목의 대안 목록을 다시 찾는다 (항목 스코프, 동기)
  const refine = useCallback((text: string) => {
    setNote(text.trim());
  }, []);

  const clearRefine = useCallback(() => {
    setNote('');
  }, []);

  /** 임의의 장소로 교체 (되돌리기 등에서 재사용). */
  const swapToPlace = useCallback(
    (place: PlannerSwapPlaceDto) => {
      if (swapMutation.isPending) return null;
      return swapMutation.mutateAsync(place);
    },
    [swapMutation],
  );

  const apply = useCallback(async () => {
    if (!itemId || !selectedId || swapMutation.isPending) return null;
    const selected = alternatives.find((alt) => alt.id === selectedId);
    if (!selected) return null;
    return swapMutation.mutateAsync(toSwapPlace(selected));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swapMutation, itemId, selectedId, alternativesQuery.data]);

  const confirmPending = useCallback(async () => {
    if (!pending || !pendingSelectedId || swapMutation.isPending) return null;
    const chosen = pending.alternatives.find((alt) => alt.id === pendingSelectedId);
    if (!chosen) return null;
    const result = await swapMutation.mutateAsync(toSwapPlace(chosen));
    setPending(null);
    setPendingSelectedId(null);
    return result;
  }, [swapMutation, pending, pendingSelectedId]);

  return {
    state,
    alternatives,
    selectedId,
    setSelectedId,
    // 장소 이름 검색 → 확인 플로우 (복수 후보 중 선택)
    searchPlace,
    searchingPlace: searchPlaceMutation.isPending,
    searchPlaceError:
      searchPlaceMutation.error instanceof Error ? searchPlaceMutation.error.message : null,
    pending,
    pendingSelectedId,
    setPendingSelectedId,
    cancelPending,
    confirmPending,
    // 조건 텍스트로 이 항목 대안 다시 찾기 (항목 스코프)
    note,
    refine,
    clearRefine,
    refining: alternativesQuery.isFetching && Boolean(note),
    apply,
    swapToPlace,
    submitting: swapMutation.isPending,
    appliedName,
    isProposalMode: !isOwner,
  };
}
