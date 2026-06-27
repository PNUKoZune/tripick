'use client';

import type { PlannerMapCenterDto, PlannerMapMarkerDto } from '@tripick/types';

import type { GeoPosition } from '@/shared/location';
import { PlannerMap } from '@/widgets/planner-map';

type Props = {
  center: PlannerMapCenterDto;
  markers: PlannerMapMarkerDto[];
  position: GeoPosition | null;
  placeholder?: string;
};

/**
 * 여행 진행용 지도. 일정 마커 + 현재 위치 마커를 함께 그리고,
 * 위치가 있으면 그 지점을 중심으로 따라간다.
 */
export function LiveMap({ center, markers, position, placeholder = '현재 위치를 표시해요' }: Props) {
  const allMarkers: PlannerMapMarkerDto[] = position
    ? [
        ...markers,
        {
          id: 'current-location',
          label: '현재 위치',
          order: 0,
          lat: position.lat,
          lng: position.lng,
          x: 0.5,
          y: 0.5,
          variant: 'current',
        },
      ]
    : markers;

  const liveCenter: PlannerMapCenterDto = position
    ? { lat: position.lat, lng: position.lng, level: center.level }
    : center;

  return (
    <PlannerMap
      placeholder={placeholder}
      center={liveCenter}
      markers={allMarkers}
      showCurrentDot={!position}
      fill
    />
  );
}
