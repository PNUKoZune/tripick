'use client';

import { useEffect, useRef, useState } from 'react';
import { LuMapPin, LuSearch, LuX } from 'react-icons/lu';
import type { ReplanPlaceDto } from '@tripick/types';

import { toResolvedPlace, useKakaoPlaceSearch, type KakaoPlace } from '@/shared/lib';

type Props = {
  value: ReplanPlaceDto[];
  onChange: (next: ReplanPlaceDto[]) => void;
  placeholder?: string;
};

/** 카카오 로컬 검색으로 실제 장소를 골라 칩으로 담는 피커 (재계획·여행 생성 공용) */
export function PlaceSearchPicker({ value, onChange, placeholder }: Props) {
  const { ready, search } = useKakaoPlaceSearch();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<KakaoPlace[]>([]);
  const [openList, setOpenList] = useState(false);
  const blurTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      search(query, (places) => {
        setResults(places);
        setOpenList(places.length > 0);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [query, ready, search]);

  function addPlace(place: KakaoPlace) {
    const resolved = toResolvedPlace(place);
    const category = place.category_group_name || place.category_name;
    const next: ReplanPlaceDto = {
      name: resolved.name,
      address: resolved.address,
      lat: resolved.lat,
      lng: resolved.lng,
      ...(category ? { category } : {}),
    };
    const exists = value.some(
      (p) => p.name === next.name && Math.abs(p.lat - next.lat) < 1e-6,
    );
    if (!exists) onChange([...value, next]);
    setQuery('');
    setResults([]);
    setOpenList(false);
  }

  return (
    <div>
      {value.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {value.map((place, index) => (
            <span
              key={`${place.name}-${index}`}
              className="flex items-center gap-1 rounded-full border border-[#C7DCFF] bg-[#EAF2FF] py-1 pl-2.5 pr-1.5 text-[12px] font-semibold text-[#1B64DA]"
            >
              <LuMapPin className="size-3" />
              <span className="max-w-[140px] truncate">{place.name}</span>
              <button
                type="button"
                aria-label={`${place.name} 제거`}
                onClick={() => onChange(value.filter((_, i) => i !== index))}
                className="flex size-4 items-center justify-center rounded-full text-[#3182F6] hover:bg-white"
              >
                <LuX className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="relative">
        <div className="flex h-11 items-center rounded-[12px] border border-[#E5E8EB] bg-white px-3 focus-within:border-[#3182F6] focus-within:ring-2 focus-within:ring-[#E1ECFF]">
          <LuSearch className="mr-2 size-4 shrink-0 text-[#8B95A1]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => {
              if (results.length > 0) setOpenList(true);
            }}
            onBlur={() => {
              blurTimer.current = window.setTimeout(() => setOpenList(false), 120);
            }}
            placeholder={ready ? (placeholder ?? '장소 이름을 검색해 추가') : '지도를 불러오는 중…'}
            disabled={!ready}
            autoComplete="off"
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-[#191F28] outline-none placeholder:text-[#B0B8C1] disabled:cursor-not-allowed"
          />
        </div>
        {openList && results.length > 0 ? (
          <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-10 max-h-56 overflow-y-auto rounded-[12px] border border-[#E5E8EB] bg-white py-1 shadow-[0_12px_28px_rgba(0,0,0,0.12)]">
            {results.map((place, index) => (
              <button
                key={`${place.place_name}-${index}`}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (blurTimer.current) window.clearTimeout(blurTimer.current);
                  addPlace(place);
                }}
                className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-[#F7F8FA]"
              >
                <span className="text-[14px] font-semibold text-[#191F28]">{place.place_name}</span>
                <span className="text-[12px] text-[#8B95A1]">
                  {place.road_address_name || place.address_name}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
