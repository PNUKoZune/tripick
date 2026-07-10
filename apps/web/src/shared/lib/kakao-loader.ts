declare global {
  interface Window {
    kakao?: {
      maps: KakaoMaps;
    };
  }
}

export type KakaoLatLng = { lat: number; lng: number };

export interface KakaoMaps {
  LatLng: new (lat: number, lng: number) => unknown;
  Map: new (container: HTMLElement, options: { center: unknown; level: number }) => KakaoMapInstance;
  Marker: new (options: { position: unknown; map?: KakaoMapInstance; image?: unknown; title?: string }) => KakaoMarkerInstance;
  CustomOverlay: new (options: {
    position: unknown;
    content: string | HTMLElement;
    xAnchor?: number;
    yAnchor?: number;
    map?: KakaoMapInstance;
  }) => KakaoOverlayInstance;
  MarkerImage: new (
    src: string,
    size: unknown,
    options?: { offset?: unknown },
  ) => unknown;
  Size: new (width: number, height: number) => unknown;
  Point: new (x: number, y: number) => unknown;
  load?: (cb: () => void) => void;
  /** 이벤트 바인딩 (지도 클릭 등). autoload=false 로드 후 사용 가능 */
  event?: KakaoEventNamespace;
  /** libraries=services 로 로드했을 때만 존재 (Geocoder / Places) */
  services?: KakaoServicesNamespace;
}

/** 지도 클릭 시 콜백으로 넘어오는 마우스 이벤트 */
export interface KakaoMouseEvent {
  latLng: { getLat(): number; getLng(): number };
}

export interface KakaoEventNamespace {
  addListener(target: unknown, type: string, handler: (event: KakaoMouseEvent) => void): void;
  removeListener(target: unknown, type: string, handler: (event: KakaoMouseEvent) => void): void;
}

/** coord2RegionCode 결과 (행정/법정 구역 1건) */
export interface KakaoRegionCode {
  region_type: 'H' | 'B';
  region_1depth_name: string;
  region_2depth_name: string;
  region_3depth_name: string;
  code: string;
}

/** keywordSearch 결과 (장소 1건) */
export interface KakaoPlace {
  /** 카카오 장소 ID (place.map.kakao.com/{id}) */
  id?: string;
  place_name: string;
  address_name: string;
  road_address_name: string;
  /** 카테고리 경로 (예: "음식점 > 카페 > 개인카페") */
  category_name?: string;
  /** 카테고리 그룹명 (예: "카페") */
  category_group_name?: string;
  x: string;
  y: string;
}

/** Places.keywordSearch 옵션 (검색 결과 편향·개수 조정) */
export interface KakaoPlacesSearchOptions {
  /** 결과 개수 (1~15) */
  size?: number;
  /** 정렬 기준 */
  sort?: 'accuracy' | 'distance';
  /** 중심 좌표 편향 (LatLng 인스턴스) */
  location?: unknown;
  /** location 기준 반경(m, 최대 20000) */
  radius?: number;
}

export interface KakaoServicesNamespace {
  Status: { OK: string; ZERO_RESULT: string; ERROR: string };
  Geocoder: new () => {
    coord2RegionCode(
      lng: number,
      lat: number,
      callback: (result: KakaoRegionCode[], status: string) => void,
    ): void;
  };
  Places: new () => {
    keywordSearch(
      query: string,
      callback: (result: KakaoPlace[], status: string) => void,
      options?: KakaoPlacesSearchOptions,
    ): void;
  };
}

export interface KakaoMapInstance {
  setCenter(latLng: unknown): void;
  panTo(latLng: unknown): void;
  setLevel(level: number): void;
  relayout(): void;
}

export interface KakaoMarkerInstance {
  setMap(map: KakaoMapInstance | null): void;
  setPosition(latLng: unknown): void;
}

export interface KakaoOverlayInstance {
  setMap(map: KakaoMapInstance | null): void;
}

let pendingPromise: Promise<KakaoMaps | null> | null = null;

export function getKakaoKey(): string | null {
  const key = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;
  return key && key.length > 0 ? key : null;
}

/**
 * Kakao Maps JS SDK 를 1회만 로드한다. 키가 없으면 null 을 돌려준다.
 */
export function loadKakaoMaps(): Promise<KakaoMaps | null> {
  if (typeof window === 'undefined') {
    return Promise.resolve(null);
  }
  const key = getKakaoKey();
  if (!key) {
    return Promise.resolve(null);
  }
  if (window.kakao?.maps) {
    return Promise.resolve(window.kakao.maps);
  }
  if (pendingPromise) {
    return pendingPromise;
  }

  pendingPromise = new Promise<KakaoMaps | null>((resolve) => {
    const existing = document.getElementById('kakao-maps-sdk') as HTMLScriptElement | null;
    const onReady = () => {
      const maps = window.kakao?.maps;
      if (!maps) {
        resolve(null);
        return;
      }
      if (typeof maps.load === 'function') {
        maps.load(() => resolve(window.kakao?.maps ?? null));
      } else {
        resolve(maps);
      }
    };

    if (existing) {
      if (window.kakao?.maps) {
        onReady();
      } else {
        existing.addEventListener('load', onReady, { once: true });
        existing.addEventListener('error', () => resolve(null), { once: true });
      }
      return;
    }

    const script = document.createElement('script');
    script.id = 'kakao-maps-sdk';
    script.async = true;
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&autoload=false&libraries=services`;
    script.onload = onReady;
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });

  return pendingPromise;
}
