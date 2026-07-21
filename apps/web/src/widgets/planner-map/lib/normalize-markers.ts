import type { PlannerMapMarkerDto } from '@tripick/types';

/**
 * 마커의 폴백 좌표(x·y, 0~1)를 좌표 범위에 맞춰 재계산한다.
 * x·y 는 Kakao SDK 미로딩 시 폴백 미리보기에서만 CSS 위치로 쓰인다.
 *
 * 서버(`MainPlannerService.withNormalizedMarkerPositions`)도 같은 식을 쓰지만,
 * 추천 대안과 장소 검색(resolve) 결과처럼 **서로 다른 응답의 마커를 클라에서
 * 병합**하면 각자 다른 bounds 로 정규화돼 어긋난다. 병합된 최종 집합을 한 번 더
 * 이 함수로 통과시켜 폴백 좌표를 일관되게 맞춘다.
 */
export function normalizeMarkerPositions(markers: PlannerMapMarkerDto[]): PlannerMapMarkerDto[] {
  if (markers.length === 0) return [];

  const lats = markers.map((m) => m.lat);
  const lngs = markers.map((m) => m.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latRange = maxLat - minLat || 1;
  const lngRange = maxLng - minLng || 1;

  return markers.map((marker) => ({
    ...marker,
    x: 0.15 + ((marker.lng - minLng) / lngRange) * 0.7,
    y: 0.15 + (1 - (marker.lat - minLat) / latRange) * 0.7,
  }));
}
