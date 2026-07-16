'use client';

import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { RouteEtaDto, RouteTransportMode } from '@tripick/types';

import { api } from '@/shared/api/client';
import { queryKeys } from '@/shared/api/query-keys';

type LatLng = { lat: number; lng: number };

const POLL_INTERVAL_MS = 60_000;

/** 목적지 좌표를 소수 4자리(~11m)로 양자화해 캐시 키를 안정화한다. */
function quantize({ lat, lng }: LatLng): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

interface UseLiveEtaParams {
  position: LatLng | null;
  next: LatLng | null;
  /** 정본 교통수단 값 (meta.transportMode). 표시용 라벨을 넘기지 말 것. */
  transportMode?: RouteTransportMode | undefined;
  enabled?: boolean;
}

interface LiveEta {
  /** OTP 실경로 기준 예상 소요 분. 조회 전/실패 시 null → 호출부에서 휴리스틱 폴백. */
  etaMin: number | null;
  /** OTP 실경로 총 거리(m). 조회 전/실패 시 null. */
  distanceM: number | null;
}

/**
 * Live 화면에서 "현재 위치 → 다음 장소" 실경로 ETA 를 60초마다 폴링한다.
 * 조회 전/실패 시 null 을 돌려 호출부가 직선거리 휴리스틱으로 폴백하게 한다.
 *
 * 현재 위치는 queryKey 에 넣지 않고 ref 로 읽는다. 키에 넣으면 GPS 가 갱신될 때마다
 * (이동 중 초당 1회꼴) 새 키 → 캐시 미스 → 즉시 재조회가 되어 refetchInterval 이
 * 무력해지기 때문. 키는 목적지+수단으로 고정하고, 각 폴링이 최신 위치를 읽어간다.
 */
export function useLiveEta({
  position,
  next,
  transportMode = 'transit',
  enabled = true,
}: UseLiveEtaParams): LiveEta {
  const positionRef = useRef(position);
  positionRef.current = position;

  const active = enabled && position !== null && next !== null;

  const { data } = useQuery<RouteEtaDto>({
    queryKey: queryKeys.routes.eta(next ? quantize(next) : 'idle', transportMode),
    queryFn: () => {
      const from = positionRef.current!;
      const params = new URLSearchParams({
        fromLat: String(from.lat),
        fromLng: String(from.lng),
        toLat: String(next!.lat),
        toLng: String(next!.lng),
        mode: transportMode,
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
  };
}
