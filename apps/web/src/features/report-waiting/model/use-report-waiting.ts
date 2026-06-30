'use client';

import { useMutation } from '@tanstack/react-query';

import { reportTripWaiting } from '@/entities/trip-plan';
import type { GeoPosition } from '@/shared/location';

interface ReportWaitingInput {
  itemId: string;
  waitingMinutes: number;
  position?: GeoPosition | null;
}

/**
 * 웨이팅 신고 → 재계획 트리거.
 * 결과(대안 일정)는 WebSocket `replan_result` 로 도착해 ReplanToast 가 노출한다.
 */
export function useReportWaiting(tripId: string) {
  return useMutation({
    mutationFn: ({ itemId, waitingMinutes, position }: ReportWaitingInput) =>
      reportTripWaiting({
        tripId,
        trigger: 'waiting',
        waitingMinutes,
        deviatedItemId: itemId,
        ...(position ? { currentLocation: { lat: position.lat, lng: position.lng } } : {}),
      }),
  });
}
