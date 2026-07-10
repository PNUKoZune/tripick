'use client';

import { useCallback, useEffect, useState } from 'react';

import { loadKakaoMaps, type KakaoPlace } from './kakao-loader';

export type KakaoResolvedPlace = {
  name: string;
  address: string;
  lat: number;
  lng: number;
};

/**
 * Kakao Places(keywordSearch)로 실제 존재하는 장소를 검색한다.
 * services 라이브러리가 로드된 뒤 `ready` 가 true 가 된다.
 */
export function useKakaoPlaceSearch() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadKakaoMaps().then((maps) => {
      if (!cancelled) setReady(Boolean(maps?.services));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const search = useCallback((keyword: string, callback: (places: KakaoPlace[]) => void) => {
    const services = window.kakao?.maps?.services;
    const trimmed = keyword.trim();
    if (!services || trimmed.length < 2) {
      callback([]);
      return;
    }
    new services.Places().keywordSearch(
      trimmed,
      (result, status) => {
        callback(status === services.Status.OK ? result : []);
      },
      { size: 10 },
    );
  }, []);

  return { ready, search };
}

/** KakaoPlace → 앱 표준 장소 형태로 변환 */
export function toResolvedPlace(place: KakaoPlace): KakaoResolvedPlace {
  return {
    name: place.place_name,
    address: place.road_address_name || place.address_name || '',
    lat: Number(place.y),
    lng: Number(place.x),
  };
}
