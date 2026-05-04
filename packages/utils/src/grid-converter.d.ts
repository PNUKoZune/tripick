/**
 * 기상청 격자 좌표 변환 유틸
 *
 * 위도(lat)·경도(lng) → 기상청 단기예보 격자 좌표(nx, ny) 변환.
 * 기상청 오픈API 활용가이드 수식 기반.
 *
 * @see https://www.data.go.kr/data/15084084/openapi.do
 */
export interface LatLng {
    lat: number;
    lng: number;
}
export interface GridXY {
    nx: number;
    ny: number;
}
/**
 * 위경도 → 기상청 격자 좌표 변환
 *
 * @example
 * latLngToGrid({ lat: 37.5665, lng: 126.9780 })
 * // → { nx: 60, ny: 127 } (서울 시청 근방)
 */
export declare function latLngToGrid({ lat, lng }: LatLng): GridXY;
/**
 * 기상청 격자 좌표 → 위경도 역변환
 */
export declare function gridToLatLng({ nx, ny }: GridXY): LatLng;
//# sourceMappingURL=grid-converter.d.ts.map