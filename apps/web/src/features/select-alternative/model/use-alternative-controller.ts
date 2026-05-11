'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PlannerAlternativeResponseDto } from '@tripick/types';

import {
  fetchPlannerAlternatives,
  swapPlannerItem,
} from '@/entities/trip-plan';

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: PlannerAlternativeResponseDto };

export function useAlternativeController(tripId: string, itemId: string | null) {
  const [state, setState] = useState<State>({ status: 'idle' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [appliedName, setAppliedName] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!itemId) {
      setState({ status: 'idle' });
      setSelectedId(null);
      setAppliedName(null);
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    fetchPlannerAlternatives(tripId, itemId)
      .then((data) => {
        if (cancelled) return;
        setState({ status: 'ready', data });
        setSelectedId(data.alternatives[0]?.id ?? null);
        setAppliedName(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message =
          error instanceof Error ? error.message : '대안을 불러오지 못했어요.';
        setState({ status: 'error', message });
      });
    return () => {
      cancelled = true;
    };
  }, [tripId, itemId]);

  const apply = useCallback(async () => {
    if (!itemId || !selectedId || submitting) return null;
    setSubmitting(true);
    try {
      const result = await swapPlannerItem(tripId, {
        itemId,
        alternativeId: selectedId,
      });
      setAppliedName(result.newItemName);
      return result;
    } finally {
      setSubmitting(false);
    }
  }, [tripId, itemId, selectedId, submitting]);

  return {
    state,
    selectedId,
    setSelectedId,
    apply,
    submitting,
    appliedName,
  };
}
