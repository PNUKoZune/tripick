'use client';

import { useEffect, useState } from 'react';

import { getReactNativeWebView } from '@/shared/rn-bridge/rn-webview';

export interface GeoPosition {
  lat: number;
  lng: number;
  accuracy?: number;
  timestamp: number;
  source: 'rn' | 'browser';
}

export interface GeoError {
  code: number;
  message: string;
}

type PermissionState = 'unknown' | 'granted' | 'denied' | 'unavailable';

type RnLocationMessage =
  | { type: 'LOCATION_UPDATE'; lat: number; lng: number; accuracy?: number; timestamp?: number }
  | { type: 'LOCATION_ERROR'; code: number; message: string };

/**
 * 현재 위치를 추적한다.
 * - RN WebView: 네이티브가 보내는 `LOCATION_UPDATE` 메시지를 수신 (권한은 앱이 처리)
 * - 브라우저 단독: `navigator.geolocation.watchPosition` 폴백 (HTTPS/localhost 필요)
 *
 * 두 경로 모두 동일한 `GeoPosition` 으로 정규화해 반환한다.
 */
export function useCurrentLocation({ enabled = true }: { enabled?: boolean } = {}) {
  const [position, setPosition] = useState<GeoPosition | null>(null);
  const [error, setError] = useState<GeoError | null>(null);
  const [permission, setPermission] = useState<PermissionState>('unknown');

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const rn = getReactNativeWebView();

    if (rn) {
      // RN → Web 위치 메시지 수신. 진입 시 추적 시작을 요청(앱 미구현이면 무시됨).
      const handle = (event: MessageEvent) => {
        if (typeof event.data !== 'string') return;
        let msg: RnLocationMessage | null = null;
        try {
          msg = JSON.parse(event.data) as RnLocationMessage;
        } catch {
          return;
        }
        if (!msg || typeof msg !== 'object' || !('type' in msg)) return;

        if (msg.type === 'LOCATION_UPDATE') {
          setPermission('granted');
          setError(null);
          setPosition({
            lat: msg.lat,
            lng: msg.lng,
            ...(msg.accuracy !== undefined ? { accuracy: msg.accuracy } : {}),
            timestamp: msg.timestamp ?? Date.now(),
            source: 'rn',
          });
        } else if (msg.type === 'LOCATION_ERROR') {
          setPermission(msg.code === 1 ? 'denied' : 'unavailable');
          setError({ code: msg.code, message: msg.message });
        }
      };

      window.addEventListener('message', handle);
      rn.postMessage(JSON.stringify({ type: 'START_LOCATION_TRACKING' }));
      return () => {
        window.removeEventListener('message', handle);
        rn.postMessage(JSON.stringify({ type: 'STOP_LOCATION_TRACKING' }));
      };
    }

    // 브라우저 폴백
    if (!('geolocation' in navigator)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- geolocation 미지원 감지 시 상태 반영(feature detection)
      setPermission('unavailable');
      setError({ code: 2, message: '이 브라우저는 위치를 지원하지 않아요.' });
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setPermission('granted');
        setError(null);
        setPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
          source: 'browser',
        });
      },
      (err) => {
        setPermission(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable');
        setError({ code: err.code, message: err.message });
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [enabled]);

  return { position, error, permission };
}
