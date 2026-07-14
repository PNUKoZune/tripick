'use client';

import { useQuery } from '@tanstack/react-query';
import type { RouteEtaDto, RouteTransportMode } from '@tripick/types';

import { api } from '@/shared/api/client';
import { queryKeys } from '@/shared/api/query-keys';

type LatLng = { lat: number; lng: number };

const POLL_INTERVAL_MS = 60_000;

/** 이동수단 라벨 → OTP 조회 모드. 도보는 대중교통(도보 leg)로 처리. */
function modeFor(transportLabel?: string): RouteTransportMode {
  if (transportLabel && (transportLabel.includes('차') || transportLabel.includes('자동차'))) {
    return 'car';
  }
  return 'transit';
}

/** GPS 미세 흔들림마다 재조회되지 않도록 좌표를 소수 4자리(~11m)로 양자화. */
function quantize({ lat, lng }: LatLng): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

interface UseLiveEtaParams {
  position: LatLng | null;
  next: LatLng | null;
  transportLabel?: string | undefined;
  enabled?: boolean;
}

interface LiveEta {
  /** OTP 실경로 기준 예상 소요 분. 조회 전/실패 시 null → 호출부에서 휴리스틱 폴백. */
  etaMin: number | null;
  /** OTP 실경로 총 거리(m). */
  distanceM: number | null;
  isLoading: boolean;
}

/**
 * Live 화면에서 "현재 위치 → 다음 장소" 실경로 ETA 를 60초마다 폴링한다.
 * 위치가 이동할수록 남은 경로가 다시 계산돼 ETA 가 자연스럽게 줄어든다.
 * 조회 전/실패 시 null 을 돌려 호출부가 직선거리 휴리스틱으로 폴백하게 한다.
 */
export function useLiveEta({
  position,
  next,
  transportLabel,
  enabled = true,
}: UseLiveEtaParams): LiveEta {
  const mode = modeFor(transportLabel);
  const active = enabled && position !== null && next !== null;

  const { data, isLoading } = useQuery<RouteEtaDto>({
    queryKey: active
      ? queryKeys.routes.eta(quantize(position), quantize(next), mode)
      : queryKeys.routes.eta('idle', 'idle', mode),
    queryFn: () => {
      const params = new URLSearchParams({
        fromLat: String(position!.lat),
        fromLng: String(position!.lng),
        toLat: String(next!.lat),
        toLng: String(next!.lng),
        mode,
      });
      return api.get<RouteEtaDto>(`/routes/eta?${params.toString()}`);
    },
    enabled: active,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    staleTime: POLL_INTERVAL_MS,
  });

  return {
    etaMin: data ? Math.max(1, Math.round(data.durationSec / 60)) : null,
    distanceM: data ? data.distanceM : null,
    isLoading: active && isLoading,
  };
}
