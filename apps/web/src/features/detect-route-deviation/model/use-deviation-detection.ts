'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { haversineMeters } from '@tripick/utils';

import { reportTripDeviation } from '@/entities/trip-plan';
import type { GeoPosition } from '@/shared/location';

/** 이탈 판정 거리(m). 이 거리를 연속으로 초과해야 이탈로 본다. */
const THRESHOLD_M = 400;
/** GPS 튐 오탐 방지용 연속 초과 횟수 */
const CONSECUTIVE = 3;

export interface NextPlace {
  itemId?: string;
  lat: number;
  lng: number;
}

interface Params {
  tripId: string;
  position: GeoPosition | null;
  nextPlace: NextPlace | null;
  enabled?: boolean;
}

/**
 * 현재 위치와 다음 예정 장소의 거리로 경로 이탈을 자동 감지한다.
 * 임계 거리를 연속 N회 초과하면 `deviated=true`. 사용자가 확인(confirm)하면
 * `/alternative/deviation` 으로 재계획을 신고하고, 무시(dismiss)하면 같은 장소 동안 다시 뜨지 않는다.
 */
export function useDeviationDetection({ tripId, position, nextPlace, enabled = true }: Params) {
  const [deviated, setDeviated] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const countRef = useRef(0);

  const { mutateAsync, isPending } = useMutation({
    mutationFn: () =>
      reportTripDeviation({
        tripId,
        trigger: 'deviation',
        ...(nextPlace?.itemId ? { deviatedItemId: nextPlace.itemId } : {}),
        ...(position ? { currentLocation: { lat: position.lat, lng: position.lng } } : {}),
      }),
  });

  // 다음 장소가 바뀌면 감지 상태 초기화
  useEffect(() => {
    countRef.current = 0;
    setDeviated(false);
    setDismissed(false);
  }, [nextPlace?.itemId]);

  const distanceM = position && nextPlace ? haversineMeters(position, nextPlace) : null;

  useEffect(() => {
    if (!enabled || distanceM === null) return;
    if (distanceM > THRESHOLD_M) {
      countRef.current += 1;
      if (countRef.current >= CONSECUTIVE) setDeviated(true);
    } else {
      countRef.current = 0;
      setDeviated(false);
    }
  }, [distanceM, enabled]);

  async function confirm() {
    await mutateAsync();
    setDeviated(false);
    setDismissed(true);
  }

  function dismiss() {
    setDeviated(false);
    setDismissed(true);
  }

  return {
    deviated: deviated && !dismissed,
    distanceM,
    confirm,
    dismiss,
    isReporting: isPending,
  };
}
