'use client';

import { useEffect, useRef, useState } from 'react';
import type { PlannerMapCenterDto, PlannerMapMarkerDto } from '@tripick/types';

import {
  getKakaoKey,
  loadKakaoMaps,
  type KakaoMapInstance,
  type KakaoOverlayInstance,
} from '@/shared/lib';

type Props = {
  placeholder: string;
  center: PlannerMapCenterDto;
  markers: PlannerMapMarkerDto[];
  showCurrentDot?: boolean;
  /** aspect 기반 비율 컨테이너 (기본). `fill` 이 true 면 무시된다. */
  aspect?: string;
  /** 부모 박스가 정해진 높이를 갖고 있고 그 높이를 채워야 할 때 true */
  fill?: boolean;
  selectedMarkerId?: string | null;
  onMarkerClick?: (marker: PlannerMapMarkerDto) => void;
  showSearch?: boolean;
};

const variantStyle: Record<PlannerMapMarkerDto['variant'], { dot: string; label: string }> = {
  primary: {
    dot: 'bg-[#3182F6] text-white border-[#1B64DA]',
    label: 'bg-white text-[#191F28] border-[#E5E8EB]',
  },
  current: {
    dot: 'bg-[#F04452] text-white border-[#C2415D]',
    label: 'bg-white text-[#F04452] border-[#FECDD3]',
  },
  alternative: {
    dot: 'bg-white text-[#1B64DA] border-[#3182F6]',
    label: 'bg-[#EAF2FF] text-[#1B64DA] border-[#C7DCFF]',
  },
};

const selectedStyle = {
  dot: 'bg-[#1B64DA] text-white border-[#1B64DA] scale-110',
  label: 'bg-[#1B64DA] text-white border-[#1B64DA]',
};

export function PlannerMap({
  placeholder,
  center,
  markers,
  showCurrentDot = true,
  aspect = 'aspect-[390/290]',
  fill = false,
  selectedMarkerId = null,
  onMarkerClick,
  showSearch = true,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<KakaoMapInstance | null>(null);
  const overlaysRef = useRef<KakaoOverlayInstance[]>([]);
  const onMarkerClickRef = useRef(onMarkerClick);
  useEffect(() => {
    onMarkerClickRef.current = onMarkerClick;
  }, [onMarkerClick]);
  const [sdkReady, setSdkReady] = useState<boolean>(false);
  const [sdkAttempted, setSdkAttempted] = useState<boolean>(false);

  // SDK 1회 로드 + 지도 초기화. 컨테이너가 0×0 이면 잠시 기다렸다 초기화한다.
  useEffect(() => {
    let cancelled = false;
    if (!getKakaoKey()) {
      setSdkAttempted(true);
      return;
    }
    loadKakaoMaps().then((maps) => {
      if (cancelled) return;
      setSdkAttempted(true);
      if (!maps) return;

      const init = () => {
        if (cancelled || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          // 다음 프레임에 다시 시도
          requestAnimationFrame(init);
          return;
        }
        mapRef.current = new maps.Map(containerRef.current, {
          center: new maps.LatLng(center.lat, center.lng),
          level: center.level,
        });
        setSdkReady(true);
      };
      init();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 컨테이너 리사이즈 시 relayout 호출 — 부모 높이가 늦게 결정되거나 분할 패널이 바뀔 때 필요
  useEffect(() => {
    if (!sdkReady || !containerRef.current || !window.kakao?.maps) return;
    const map = mapRef.current;
    if (!map) return;
    const maps = window.kakao.maps;
    const observer = new ResizeObserver(() => {
      map.relayout();
      map.setCenter(new maps.LatLng(center.lat, center.lng));
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [sdkReady, center.lat, center.lng]);

  // center / level 변경 시 이동
  useEffect(() => {
    if (!sdkReady || !mapRef.current || !window.kakao?.maps) return;
    const maps = window.kakao.maps;
    mapRef.current.setCenter(new maps.LatLng(center.lat, center.lng));
    mapRef.current.setLevel(center.level);
    mapRef.current.relayout();
  }, [sdkReady, center.lat, center.lng, center.level]);

  // 마커/오버레이 동기화
  useEffect(() => {
    if (!sdkReady || !mapRef.current || !window.kakao?.maps) return;
    const maps = window.kakao.maps;
    const map = mapRef.current;
    overlaysRef.current.forEach((overlay) => overlay.setMap(null));
    overlaysRef.current = markers.map((marker) => {
      const isSelected = marker.id === selectedMarkerId;
      const style = isSelected ? selectedStyle : variantStyle[marker.variant];
      const content = document.createElement('div');
      content.className = `flex flex-col items-center gap-1 ${onMarkerClickRef.current ? 'cursor-pointer' : ''}`;
      content.innerHTML = `
        <span class="flex size-7 items-center justify-center rounded-full border text-[12px] font-bold transition-transform ${style.dot}">${marker.order > 0 ? marker.order : '·'}</span>
        <span class="inline-block max-w-[112px] truncate rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${style.label}">${escapeHtml(marker.label)}</span>
      `;
      if (onMarkerClickRef.current) {
        content.addEventListener('click', (e) => {
          e.stopPropagation();
          onMarkerClickRef.current?.(marker);
        });
      }
      return new maps.CustomOverlay({
        position: new maps.LatLng(marker.lat, marker.lng),
        content,
        xAnchor: 0.5,
        yAnchor: 0,
        map,
      });
    });
  }, [sdkReady, markers, selectedMarkerId]);

  const showFallback = sdkAttempted && !sdkReady;
  const outerClass = fill
    ? 'relative h-full w-full overflow-hidden bg-[#F7F8FA]'
    : 'relative overflow-hidden bg-[#F7F8FA]';
  const innerClass = fill ? 'relative h-full w-full' : `relative w-full ${aspect}`;

  return (
    <div className={outerClass}>
      <div ref={containerRef} className={innerClass}>
        {showFallback ? (
          <FallbackMap
            placeholder={placeholder}
            markers={markers}
            showCurrentDot={showCurrentDot}
            selectedMarkerId={selectedMarkerId}
            onMarkerClick={onMarkerClick}
          />
        ) : null}
      </div>
      {showSearch ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 px-3 pt-3">
          <div className="pointer-events-auto flex h-9 flex-1 items-center rounded-[16px] border border-[#E5E8EB] bg-white px-3 text-[13px] text-[#8B95A1] shadow-[0_4px_12px_rgba(15,23,42,0.06)]">
            <span aria-hidden className="mr-2">
              🔍
            </span>
            {placeholder}
          </div>
          <button
            type="button"
            className="pointer-events-auto h-9 rounded-[16px] bg-[#3182F6] px-3 text-[13px] font-semibold text-white shadow-[0_4px_12px_rgba(49,130,246,0.24)]"
          >
            길찾기
          </button>
        </div>
      ) : null}
      <div className="pointer-events-none absolute bottom-2 right-3 rounded-md bg-white/85 px-2 py-0.5 text-[10px] font-semibold text-[#6B7684]">
        kakaomap
      </div>
    </div>
  );
}

type FallbackProps = {
  placeholder: string;
  markers: PlannerMapMarkerDto[];
  showCurrentDot?: boolean;
  selectedMarkerId?: string | null;
  onMarkerClick?: ((marker: PlannerMapMarkerDto) => void) | undefined;
};

function FallbackMap({ markers, showCurrentDot, selectedMarkerId, onMarkerClick }: FallbackProps) {
  return (
    <div className="absolute inset-0 bg-[#EEF2F4]">
      <div className="absolute inset-x-0 top-0 h-1/2 bg-[#F2F4F6]" />
      <div className="absolute left-1/4 top-2/3 h-12 w-full bg-[#E1ECF7]" />
      {markers.map((marker) => {
        const isSelected = marker.id === selectedMarkerId;
        const style = isSelected ? selectedStyle : variantStyle[marker.variant];
        return (
          <button
            key={marker.id}
            type="button"
            onClick={() => onMarkerClick?.(marker)}
            disabled={!onMarkerClick}
            className="absolute -translate-x-1/2 -translate-y-1/2 text-center"
            style={{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }}
          >
            <span
              className={`flex size-7 items-center justify-center rounded-full border text-[12px] font-bold transition-transform ${style.dot}`}
            >
              {marker.order > 0 ? marker.order : '·'}
            </span>
            <span
              className={`mt-1 inline-block max-w-[112px] truncate rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${style.label}`}
            >
              {marker.label}
            </span>
          </button>
        );
      })}
      {showCurrentDot ? (
        <div className="absolute left-[42%] top-[58%] flex size-9 items-center justify-center rounded-full bg-[#3182F6]/20">
          <span className="size-3 rounded-full bg-[#3182F6]" />
        </div>
      ) : null}
      <div className="absolute bottom-2 left-3 rounded-full bg-white/85 px-2 py-0.5 text-[10px] font-semibold text-[#6B7684]">
        SDK key 미설정 — 폴백 미리보기
      </div>
    </div>
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
