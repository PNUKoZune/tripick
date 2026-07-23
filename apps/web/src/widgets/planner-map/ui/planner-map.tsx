'use client';

import { useEffect, useRef, useState } from 'react';
import { FiMapPin, FiNavigation, FiSearch, FiX } from 'react-icons/fi';
import type { PlannerMapCenterDto, PlannerMapMarkerDto } from '@tripick/types';

import {
  getKakaoKey,
  loadKakaoMaps,
  type KakaoMapInstance,
  type KakaoOverlayInstance,
  type KakaoPlace,
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
  /** 값이 바뀔 때마다 현재 center 로 부드럽게 재이동한다 (현재 위치 버튼 등) */
  recenterKey?: number;
  /** 지정 시, 검색으로 고른 장소를 일정에 반영하는 액션 버튼을 노출한다 */
  onPickSearchPlace?: (place: {
    name: string;
    address: string;
    lat: number;
    lng: number;
    kakaoPlaceId?: string;
  }) => void;
  /** 반영 버튼 라벨 (기본: "이 장소로 일정 변경") */
  pickPlaceLabel?: string;
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
  recenterKey,
  onPickSearchPlace,
  pickPlaceLabel = '이 장소로 일정 변경',
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

  // 지도 검색 (Kakao Places keywordSearch)
  const searchOverlayRef = useRef<KakaoOverlayInstance | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<KakaoPlace[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<{
    name: string;
    address: string;
    lat: number;
    lng: number;
    kakaoPlaceId?: string;
  } | null>(null);

  // SDK 1회 로드 + 지도 초기화. 컨테이너가 0×0 이면 잠시 기다렸다 초기화한다.
  useEffect(() => {
    let cancelled = false;
    if (!getKakaoKey()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- SDK 로드 effect: 카카오 키 없음을 시도 완료로 표시
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

  // 현재 위치 버튼 등으로 재이동 요청 (같은 center 라도 매번 panTo)
  useEffect(() => {
    if (recenterKey === undefined) return;
    if (!sdkReady || !mapRef.current || !window.kakao?.maps) return;
    const maps = window.kakao.maps;
    mapRef.current.setLevel(center.level);
    mapRef.current.panTo(new maps.LatLng(center.lat, center.lng));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterKey]);

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

  // 검색어 입력 → Kakao Places 키워드 검색 (services 라이브러리 필요)
  useEffect(() => {
    if (!sdkReady) return;
    const services = window.kakao?.maps?.services;
    if (!services) return;
    const keyword = searchQuery.trim();
    if (keyword.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 검색어가 짧으면 결과를 비움(비동기 검색 effect)
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      const places = new services.Places();
      places.keywordSearch(
        keyword,
        (result, status) => {
          if (status === services.Status.OK) {
            setSearchResults(result);
            setSearchOpen(true);
          } else {
            setSearchResults([]);
          }
        },
        { size: 10 },
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery, sdkReady]);

  // 언마운트 시 검색 마커 정리
  useEffect(() => {
    return () => {
      searchOverlayRef.current?.setMap(null);
    };
  }, []);

  const selectSearchPlace = (place: KakaoPlace) => {
    const maps = window.kakao?.maps;
    const map = mapRef.current;
    if (!maps || !map) return;
    const lat = Number(place.y);
    const lng = Number(place.x);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return;
    map.setLevel(3);
    map.panTo(new maps.LatLng(lat, lng));
    searchOverlayRef.current?.setMap(null);
    const content = document.createElement('div');
    content.className = 'flex flex-col items-center';
    content.innerHTML = `
      <span class="flex size-7 items-center justify-center rounded-full border border-[#C2415D] bg-[#F04452] text-white shadow-[0_4px_10px_rgba(240,68,82,0.4)]"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg></span>
      <span class="mt-1 inline-block max-w-[140px] truncate rounded-md border border-[#FECDD3] bg-white px-1.5 py-0.5 text-[11px] font-semibold text-[#F04452]">${escapeHtml(place.place_name)}</span>
    `;
    searchOverlayRef.current = new maps.CustomOverlay({
      position: new maps.LatLng(lat, lng),
      content,
      xAnchor: 0.5,
      yAnchor: 1,
      map,
    });
    setSelectedPlace({
      name: place.place_name,
      address: place.road_address_name || place.address_name || '',
      lat,
      lng,
      ...(place.id ? { kakaoPlaceId: place.id } : {}),
    });
    setSearchQuery(place.place_name);
    setSearchOpen(false);
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSearchResults([]);
    setSearchOpen(false);
    setSelectedPlace(null);
    searchOverlayRef.current?.setMap(null);
    searchOverlayRef.current = null;
  };

  // 길찾기 대상: 검색 선택 장소 > 선택된 마커 > 순번 있는 첫 마커
  const directionsTarget =
    selectedPlace ??
    (() => {
      const marker =
        markers.find((m) => m.id === selectedMarkerId) ??
        markers.find((m) => m.order > 0) ??
        markers[0];
      return marker ? { name: marker.label, lat: marker.lat, lng: marker.lng } : null;
    })();

  // Kakao Map 길찾기 화면 열기 (JS SDK 에는 경로 렌더링이 없어 링크로 위임)
  const openDirections = () => {
    if (!directionsTarget) return;
    const { name, lat, lng } = directionsTarget;
    const url = `https://map.kakao.com/link/to/${encodeURIComponent(name)},${lat},${lng}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

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
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 px-3 pt-3">
          <div className="flex items-start gap-2">
          <div className="pointer-events-auto relative flex-1">
            <div className="flex h-9 items-center rounded-[16px] border border-[color:var(--line)] bg-[color:var(--card)] px-3 shadow-[0_4px_12px_rgba(15,23,42,0.06)]">
              <FiSearch aria-hidden className="mr-2 size-4 shrink-0 text-[color:var(--ink-faint)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onFocus={() => {
                  if (searchResults.length > 0) setSearchOpen(true);
                }}
                onBlur={() => setTimeout(() => setSearchOpen(false), 120)}
                placeholder={sdkReady ? placeholder : '지도를 불러오는 중…'}
                disabled={!sdkReady}
                autoComplete="off"
                className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-[color:var(--ink)] outline-none placeholder:text-[color:var(--ink-faint)] disabled:cursor-not-allowed"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={clearSearch}
                  aria-label="검색 지우기"
                  className="ml-1 flex shrink-0 items-center text-[color:var(--ink-faint)] hover:text-[color:var(--ink-sub)]"
                >
                  <FiX className="size-4" />
                </button>
              ) : null}
            </div>
            {searchOpen && searchResults.length > 0 ? (
              <div className="absolute left-0 right-0 top-[calc(100%+4px)] max-h-64 overflow-y-auto rounded-[14px] border border-[color:var(--line)] bg-[color:var(--card)] py-1 shadow-[0_12px_28px_rgba(0,0,0,0.12)]">
                {searchResults.map((place, index) => (
                  <button
                    key={`${place.place_name}-${index}`}
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      selectSearchPlace(place);
                    }}
                    className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-[color:var(--card-soft)]"
                  >
                    <span className="text-[13px] font-semibold text-[color:var(--ink)]">
                      {place.place_name}
                    </span>
                    <span className="text-[11px] text-[color:var(--ink-faint)]">
                      {place.road_address_name || place.address_name}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={openDirections}
            disabled={!directionsTarget}
            aria-label="길찾기"
            title={directionsTarget ? `${directionsTarget.name} 길찾기` : '길찾기 대상이 없어요'}
            className="pointer-events-auto flex h-9 shrink-0 items-center gap-1.5 rounded-[16px] bg-[color:var(--btn-bg)] px-3 text-[13px] font-semibold text-[color:var(--btn-text)] shadow-[0_4px_12px_rgba(49,130,246,0.24)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <FiNavigation className="size-4" />
            길찾기
          </button>
          </div>
          {onPickSearchPlace && selectedPlace && !searchOpen ? (
            <div className="pointer-events-auto mt-2 flex items-center justify-between gap-2 rounded-[14px] border border-[color:var(--line)] bg-[color:var(--primary-tint)] px-3 py-2 shadow-[0_4px_12px_rgba(49,130,246,0.14)]">
              <span className="flex min-w-0 items-center gap-1.5 text-[12px] font-semibold text-[color:var(--primary-deep)]">
                <FiMapPin aria-hidden className="size-3.5 shrink-0" />
                <span className="truncate">{selectedPlace.name}</span>
              </span>
              <button
                type="button"
                onClick={() => onPickSearchPlace(selectedPlace)}
                className="shrink-0 rounded-[10px] bg-[color:var(--btn-bg)] px-2.5 py-1.5 text-[12px] font-bold text-[color:var(--btn-text)] hover:bg-[color:var(--btn-bg-press)]"
              >
                {pickPlaceLabel}
              </button>
            </div>
          ) : null}
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
