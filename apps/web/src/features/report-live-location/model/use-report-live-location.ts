'use client';

import { useEffect, useRef } from 'react';

import { reportLiveLocation } from '@/entities/trip-plan';
import type { GeoPosition } from '@/shared/location';

/** 서버 보고 최소 간격(ms). 위치 갱신은 잦지만(수초) 미도착 판정은 분 단위라 과보고를 막는다. */
const REPORT_THROTTLE_MS = 60_000;

interface Params {
  position: GeoPosition | null;
  enabled?: boolean;
}

/**
 * 여행 진행 중 현재 위치를 서버에 주기적으로 보고한다(미도착 감지용).
 * 서버는 이 위치를 캐시했다가 일정 시작 시각에 도착 여부를 판정한다.
 *
 * 앱이 포그라운드일 때만 동작한다(웹 훅). 백그라운드·종료 상태 보고는 네이티브
 * foreground service 가 서버로 직접 POST 하는 후속 작업으로 커버한다.
 *
 * 보고는 부수효과라 실패해도 조용히 무시한다 — 다음 위치 갱신에서 재시도된다.
 */
export function useReportLiveLocation({ position, enabled = true }: Params) {
  const lastSentAtRef = useRef(0);

  useEffect(() => {
    if (!enabled || !position) return;

    const now = Date.now();
    if (now - lastSentAtRef.current < REPORT_THROTTLE_MS) return;
    lastSentAtRef.current = now;

    void reportLiveLocation({
      lat: position.lat,
      lng: position.lng,
      ...(position.accuracy !== undefined ? { accuracy: position.accuracy } : {}),
    }).catch(() => undefined);
  }, [position, enabled]);
}
