'use client';

import { useState } from 'react';
import type { PlannerMapCenterDto, PlannerMapMarkerDto } from '@tripick/types';

import type { GeoPosition } from '@/shared/location';
import { PlannerMap } from '@/widgets/planner-map';

/** 일정 선택 시 지도 확대 레벨 (카카오맵: 작을수록 가까움) */
const FOCUS_LEVEL = 4;

type Props = {
  center: PlannerMapCenterDto;
  markers: PlannerMapMarkerDto[];
  position: GeoPosition | null;
  placeholder?: string;
  /** 선택된 일정 좌표. 있으면 현재 위치보다 우선해 지도 중심으로 둔다 */
  focusCoord?: { lat: number; lng: number } | null;
  selectedMarkerId?: string | null;
  /** 현재 위치 버튼을 눌렀을 때 (선택 해제 등 상위 처리용) */
  onRecenterToCurrent?: () => void;
};

/**
 * 여행 진행용 지도. 일정 마커 + 현재 위치 마커를 함께 그린다.
 * 선택된 일정(focusCoord)이 있으면 그 좌표를, 없으면 현재 위치를 중심으로 둔다.
 */
export function LiveMap({
  center,
  markers,
  position,
  placeholder = '현재 위치를 표시해요',
  focusCoord = null,
  selectedMarkerId = null,
  onRecenterToCurrent,
}: Props) {
  const [recenterKey, setRecenterKey] = useState(0);

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

  // 일정 선택·현재 위치 모두 동일한 확대 레벨로 가깝게 본다 (level 작을수록 확대)
  const liveCenter: PlannerMapCenterDto = focusCoord
    ? { lat: focusCoord.lat, lng: focusCoord.lng, level: FOCUS_LEVEL }
    : position
      ? { lat: position.lat, lng: position.lng, level: FOCUS_LEVEL }
      : center;

  return (
    <div className="relative h-full w-full">
      <PlannerMap
        placeholder={placeholder}
        center={liveCenter}
        markers={allMarkers}
        showCurrentDot={!position}
        showSearch={false}
        selectedMarkerId={selectedMarkerId}
        recenterKey={recenterKey}
        fill
      />
      {position ? (
        <button
          type="button"
          aria-label="현재 위치로 이동"
          onClick={() => {
            onRecenterToCurrent?.();
            setRecenterKey((key) => key + 1);
          }}
          className="absolute bottom-3 right-3 z-10 flex size-11 items-center justify-center rounded-full border border-[#E5E8EB] bg-white shadow-[0_4px_12px_rgba(15,23,42,0.16)] active:scale-95"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-5"
            fill="none"
            stroke="#3182F6"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <circle cx="12" cy="12" r="3.5" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
