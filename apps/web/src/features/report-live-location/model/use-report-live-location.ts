'use client';

import { useEffect, useRef } from 'react';

import { reportLiveLocation } from '@/entities/trip-plan';
import { apiBaseUrl } from '@/shared/api/client';
import { getReactNativeWebView } from '@/shared/rn-bridge/rn-webview';
import { isNativeShell } from '@/shared/rn-bridge/native-refresh-token';
import { getAccessToken } from '@/shared/lib/session-token';
import type { GeoPosition } from '@/shared/location';

/** 서버 보고 최소 간격(ms). 위치 갱신은 잦지만(수초) 미도착 판정은 분 단위라 과보고를 막는다. */
const REPORT_THROTTLE_MS = 60_000;

interface Params {
  position: GeoPosition | null;
  enabled?: boolean;
}

/**
 * 여행 진행 중 현재 위치를 서버에 보고한다(미도착 감지용). 서버는 이 위치를 캐시했다가
 * 일정 시작 시각에 도착 여부를 판정한다.
 *
 * 실행 환경에 따라 보고 주체가 갈린다:
 * - **RN 웹뷰**: 네이티브가 보고를 담당한다(앱 백그라운드·종료 시에도 foreground service 로
 *   위치를 잡아 서버에 POST). 웹은 인증정보(access token + API base)만 네이티브로 넘긴다 —
 *   웹뷰 JS 는 앱이 백그라운드로 가면 멈추므로 웹이 직접 보고하면 백그라운드를 못 덮는다.
 * - **브라우저 단독**: 웹이 직접 `POST /live/location`(스로틀 60초). 실패해도 조용히 무시한다.
 */
export function useReportLiveLocation({ position, enabled = true }: Params) {
  // 최신 위치를 ref 로 들고 있다가 하트비트가 읽는다 — 위치가 갱신되지 않아도(정지) 재보고하려고.
  const positionRef = useRef(position);
  positionRef.current = position;

  // 렌더마다 최신 토큰을 읽는다(SSR-safe). 값이 바뀌면 아래 effect 가 다시 브리지한다.
  const accessToken = getAccessToken();

  // RN: 네이티브에 인증정보를 넘겨 보고 주체를 위임한다. 토큰이 바뀌거나(리프레시) 마운트 시
  // null→값 으로 채워지면 deps 가 바뀌어 다시 넘긴다 — 네이티브가 stale 토큰을 쓰지 않게.
  useEffect(() => {
    if (!enabled || !accessToken) return;
    const rn = getReactNativeWebView();
    if (!rn) return;
    rn.postMessage(
      JSON.stringify({ type: 'LOCATION_AUTH', accessToken, apiBaseUrl: apiBaseUrl() }),
    );
  }, [enabled, accessToken]);

  // 브라우저 단독: 웹이 직접 보고. RN 이면 네이티브가 담당하므로 웹은 보내지 않는다(중복 방지).
  // 하트비트로 최신 위치를 주기적으로 보낸다 — 위치 갱신은 이동 기반이라 사용자가 멈춰 있으면
  // 끊기는데, 그러면 서버 캐시가 stale 돼 "안 움직이는 no-show" 를 못 잡는다. 마지막 위치를
  // 계속 재보고해 캐시를 신선하게 유지한다.
  useEffect(() => {
    if (!enabled) return;
    if (isNativeShell()) return;

    const report = () => {
      const p = positionRef.current;
      if (!p) return;
      void reportLiveLocation({
        lat: p.lat,
        lng: p.lng,
        ...(p.accuracy !== undefined ? { accuracy: p.accuracy } : {}),
      }).catch(() => undefined);
    };

    report(); // 위치가 이미 있으면 즉시 1회
    const id = setInterval(report, REPORT_THROTTLE_MS);
    return () => clearInterval(id);
  }, [enabled]);
}
