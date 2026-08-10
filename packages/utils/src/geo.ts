/**
 * 좌표 거리 계산 유틸
 *
 * 위도(lat)·경도(lng) 두 지점 사이의 대권 거리(great-circle distance)를
 * haversine 공식으로 계산한다. 경로 이탈 감지 등 단거리 비교에 사용.
 */

import type { LatLng } from './grid-converter';

const EARTH_RADIUS_M = 6371008.8; // 지구 평균 반경 (m)

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** 두 좌표 사이의 거리 (미터). */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}
