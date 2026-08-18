'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getKakaoKey,
  loadKakaoMaps,
  type KakaoMapInstance,
  type KakaoMarkerInstance,
} from '@/shared/lib';
import { LuMap } from 'react-icons/lu';

import { BottomSheet } from '@/shared/ui';

type Props = {
  /** 지도에서 지역을 확정했을 때 destination 값으로 전달 */
  onSelect: (name: string) => void;
};

type Picked = {
  /** destination 으로 사용할 값 (시군구 우선) */
  name: string;
  /** 사용자에게 보여줄 전체 라벨 (예: "부산광역시 해운대구") */
  label: string;
};

// 대한민국 전체가 보이는 기본 시점
const DEFAULT_CENTER = { lat: 36.5, lng: 127.9, level: 13 };

export function DestinationMapPicker({ onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const hasKey = getKakaoKey() !== null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-12 shrink-0 items-center gap-1.5 rounded-[14px] border border-[color:var(--line,#E5E8EB)] bg-[color:var(--card-soft,#FFFFFF)] px-3.5 text-[13px] font-semibold text-[color:var(--ink-sub,#4E5968)] transition hover:border-[color:var(--primary,#3182F6)] hover:text-[color:var(--primary,#3182F6)]"
      >
        <LuMap aria-hidden className="size-4" />
        지도
      </button>
      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        label="지도에서 여행 지역 선택"
        themed
      >
        <MapPickerContent
          hasKey={hasKey}
          onConfirm={(name) => {
            onSelect(name);
            setOpen(false);
          }}
        />
      </BottomSheet>
    </>
  );
}

function MapPickerContent({
  hasKey,
  onConfirm,
}: {
  hasKey: boolean;
  onConfirm: (name: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<KakaoMapInstance | null>(null);
  const markerRef = useRef<KakaoMarkerInstance | null>(null);
  const geocoderRef = useRef<{
    coord2RegionCode: (
      lng: number,
      lat: number,
      cb: (result: Array<{ region_type: string; region_1depth_name: string; region_2depth_name: string }>, status: string) => void,
    ) => void;
  } | null>(null);
  const placesRef = useRef<{
    keywordSearch: (
      q: string,
      cb: (result: Array<{ x: string; y: string }>, status: string) => void,
    ) => void;
  } | null>(null);

  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [query, setQuery] = useState('');

  // 좌표 → 행정구역 역지오코딩 후 마커/선택값 갱신
  const resolveRegion = useCallback((lat: number, lng: number) => {
    const maps = window.kakao?.maps;
    const geocoder = geocoderRef.current;
    if (!maps || !geocoder) return;

    if (markerRef.current) {
      markerRef.current.setPosition(new maps.LatLng(lat, lng));
    } else if (mapRef.current) {
      markerRef.current = new maps.Marker({
        position: new maps.LatLng(lat, lng),
        map: mapRef.current,
      });
    }

    setGeocoding(true);
    geocoder.coord2RegionCode(lng, lat, (result, status) => {
      setGeocoding(false);
      if (status !== maps.services?.Status.OK || result.length === 0) {
        setPicked(null);
        return;
      }
      // 행정동(H) 우선, 없으면 첫 결과
      const region = result.find((r) => r.region_type === 'H') ?? result[0];
      if (!region) {
        setPicked(null);
        return;
      }
      const sido = region.region_1depth_name?.trim() ?? '';
      const sigungu = region.region_2depth_name?.trim() ?? '';
      const name = sigungu || sido;
      if (!name) {
        setPicked(null);
        return;
      }
      setPicked({ name, label: [sido, sigungu].filter(Boolean).join(' ') });
    });
  }, []);

  // 시트가 열리면 지도 1회 초기화 + 클릭 리스너 바인딩
  useEffect(() => {
    if (!hasKey) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 지도 초기화 effect: 카카오 키 없음을 실패 상태로 표시
      setFailed(true);
      return;
    }
    let cancelled = false;

    loadKakaoMaps().then((maps) => {
      if (cancelled) return;
      if (!maps || !maps.services || !maps.event) {
        setFailed(true);
        return;
      }

      const init = () => {
        if (cancelled || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          requestAnimationFrame(init);
          return;
        }
        const map = new maps.Map(containerRef.current, {
          center: new maps.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng),
          level: DEFAULT_CENTER.level,
        });
        mapRef.current = map;
        geocoderRef.current = new maps.services!.Geocoder();
        placesRef.current = new maps.services!.Places();
        maps.event!.addListener(map, 'click', (event) => {
          resolveRegion(event.latLng.getLat(), event.latLng.getLng());
        });
        setReady(true);
        // 시트 슬라이드업 완료 후 레이아웃 보정
        window.setTimeout(() => map.relayout(), 360);
      };
      init();
    });

    return () => {
      cancelled = true;
    };
  }, [hasKey, resolveRegion]);

  function handleSearch() {
    const maps = window.kakao?.maps;
    const places = placesRef.current;
    const map = mapRef.current;
    const q = query.trim();
    if (!maps || !places || !map || !q) return;
    places.keywordSearch(q, (result, status) => {
      if (status !== maps.services?.Status.OK || result.length === 0) return;
      const first = result[0];
      if (!first) return;
      const lat = Number(first.y);
      const lng = Number(first.x);
      map.setLevel(6);
      map.panTo(new maps.LatLng(lat, lng));
      resolveRegion(lat, lng);
    });
  }

  if (failed) {
    return (
      <div className="py-8 text-center">
        <p className="text-[15px] font-semibold text-[color:var(--ink,#191F28)]">지도를 불러올 수 없어요</p>
        <p className="mt-1.5 text-[13px] text-[color:var(--ink-faint,#8B95A1)]">
          지도 키가 설정되지 않았습니다. 상단 입력창에서 직접 검색해 주세요.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-[16px] font-bold text-[color:var(--ink,#191F28)]">지도에서 여행 지역 선택</h2>
        <p className="mt-0.5 text-[13px] text-[color:var(--ink-faint,#8B95A1)]">
          지도를 눌러 지역을 고르거나, 장소를 검색해 이동하세요.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              handleSearch();
            }
          }}
          placeholder="예) 해운대해수욕장, 경주역"
          className="h-11 min-w-0 flex-1 rounded-[12px] border border-[color:var(--line,#E5E8EB)] bg-[color:var(--card-soft,#FFFFFF)] px-3.5 text-[14px] text-[color:var(--ink,#191F28)] outline-none focus:border-[color:var(--primary,#3182F6)] focus:ring-2 focus:ring-[color:var(--ring,#E1ECFF)]"
        />
        <button
          type="button"
          onClick={handleSearch}
          className="h-11 shrink-0 rounded-[12px] bg-[color:var(--card-soft,#F2F4F6)] px-4 text-[14px] font-semibold text-[color:var(--ink-sub,#4E5968)] hover:bg-[color:var(--line,#E8EBED)]"
        >
          검색
        </button>
      </div>

      <div className="relative h-[300px] w-full overflow-hidden rounded-[16px] border border-[color:var(--line,#E5E8EB)] bg-[color:var(--card-soft,#F7F8FA)]">
        <div ref={containerRef} className="h-full w-full" />
        {!ready ? (
          <div className="absolute inset-0 flex items-center justify-center text-[13px] text-[color:var(--ink-faint,#B0B8C1)]">
            지도 불러오는 중…
          </div>
        ) : null}
      </div>

      <div className="rounded-[12px] bg-[color:var(--card-soft,#F7F8FA)] px-4 py-3 text-[14px]">
        {geocoding ? (
          <span className="text-[color:var(--ink-faint,#8B95A1)]">지역 확인 중…</span>
        ) : picked ? (
          <span className="font-semibold text-[color:var(--ink,#191F28)]">
            선택: <span className="text-[color:var(--primary,#3182F6)]">{picked.label}</span>
          </span>
        ) : (
          <span className="text-[color:var(--ink-faint,#8B95A1)]">지도를 눌러 위치를 선택하세요</span>
        )}
      </div>

      <button
        type="button"
        disabled={!picked}
        onClick={() => picked && onConfirm(picked.name)}
        className="h-12 w-full rounded-[14px] bg-[color:var(--btn-bg,#3182F6)] text-[15px] font-bold text-[color:var(--btn-text,#FFFFFF)] transition disabled:bg-[color:var(--line,#C7DCFF)] disabled:text-[color:var(--ink-faint,#FFFFFF)]"
      >
        {picked ? `‘${picked.name}’(으)로 선택` : '위치를 선택해주세요'}
      </button>
    </div>
  );
}
