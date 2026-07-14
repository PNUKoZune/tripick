/**
 * 기상청 중기예보 지역코드(regId) 매핑 유틸
 *
 * 단기예보가 nx·ny 격자를 쓰는 것과 달리, 중기예보(중기육상예보·중기기온)는
 * 예보구역 코드(regId)를 사용한다. 위경도를 가장 가까운 대표도시 중심점으로
 * 스냅해 해당 구역의 육상예보/기온 regId 를 돌려준다.
 *
 * - landRegId: 중기육상예보(getMidLandFcst) 구역 코드 (도 단위 10구역)
 * - taRegId  : 중기기온(getMidTa) 구역 코드 (대표도시 단위)
 *
 * 코드값은 기상청 중기예보 조회서비스 활용가이드 기준.
 * @see https://www.data.go.kr/data/15059468/openapi.do
 */

import { haversineMeters } from './geo';
import type { LatLng } from './grid-converter';

export interface MidRegion {
  /** 대표 지역명 (디버깅용) */
  name: string;
  /** 대표도시 중심 위경도 */
  lat: number;
  lng: number;
  /** 중기육상예보(getMidLandFcst) regId */
  landRegId: string;
  /** 중기기온(getMidTa) regId */
  taRegId: string;
}

/**
 * 전국 대표도시별 중기예보 구역 코드.
 * 육상예보 구역(도 단위)에 대표도시 기온 구역을 짝지어, 위경도를
 * nearest-centroid 로 스냅한다. 국내 여행 수준의 해상도면 충분하다.
 */
export const MID_REGIONS: readonly MidRegion[] = [
  // 서울·인천·경기 (육상 11B00000)
  { name: '서울', lat: 37.5665, lng: 126.978, landRegId: '11B00000', taRegId: '11B10101' },
  { name: '인천', lat: 37.4563, lng: 126.7052, landRegId: '11B00000', taRegId: '11B20201' },
  { name: '수원', lat: 37.2636, lng: 127.0286, landRegId: '11B00000', taRegId: '11B20601' },
  // 강원 (영서 11D10000 / 영동 11D20000)
  { name: '춘천', lat: 37.8813, lng: 127.73, landRegId: '11D10000', taRegId: '11D10401' },
  { name: '강릉', lat: 37.7519, lng: 128.8761, landRegId: '11D20000', taRegId: '11D20501' },
  // 충북 (11C10000) / 대전·세종·충남 (11C20000)
  { name: '청주', lat: 36.6424, lng: 127.489, landRegId: '11C10000', taRegId: '11C10301' },
  { name: '대전', lat: 36.3504, lng: 127.3845, landRegId: '11C20000', taRegId: '11C20401' },
  // 전북 (11F10000) / 광주·전남 (11F20000)
  { name: '전주', lat: 35.8242, lng: 127.148, landRegId: '11F10000', taRegId: '11F10201' },
  { name: '광주', lat: 35.1595, lng: 126.8526, landRegId: '11F20000', taRegId: '11F20401' },
  { name: '여수', lat: 34.7604, lng: 127.6622, landRegId: '11F20000', taRegId: '11F20501' },
  // 대구·경북 (11H10000)
  { name: '대구', lat: 35.8714, lng: 128.6014, landRegId: '11H10000', taRegId: '11H10701' },
  { name: '안동', lat: 36.5684, lng: 128.7294, landRegId: '11H10000', taRegId: '11H10201' },
  // 부산·울산·경남 (11H20000)
  { name: '부산', lat: 35.1796, lng: 129.0756, landRegId: '11H20000', taRegId: '11H20201' },
  { name: '울산', lat: 35.5384, lng: 129.3114, landRegId: '11H20000', taRegId: '11H20101' },
  { name: '창원', lat: 35.228, lng: 128.6811, landRegId: '11H20000', taRegId: '11H20301' },
  // 제주 (11G00000)
  { name: '제주', lat: 33.4996, lng: 126.5312, landRegId: '11G00000', taRegId: '11G00201' },
  { name: '서귀포', lat: 33.2541, lng: 126.5601, landRegId: '11G00000', taRegId: '11G00401' },
];

/**
 * 위경도 → 가장 가까운 중기예보 구역.
 *
 * @example
 * latLngToMidRegion({ lat: 37.5665, lng: 126.978 })
 * // → { name: '서울', landRegId: '11B00000', taRegId: '11B10101', ... }
 */
export function latLngToMidRegion({ lat, lng }: LatLng): MidRegion {
  let nearest = MID_REGIONS[0]!;
  let minDist = Infinity;

  for (const region of MID_REGIONS) {
    const dist = haversineMeters({ lat, lng }, { lat: region.lat, lng: region.lng });
    if (dist < minDist) {
      minDist = dist;
      nearest = region;
    }
  }

  return nearest;
}
