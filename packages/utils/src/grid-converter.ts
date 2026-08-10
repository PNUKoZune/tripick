/**
 * 기상청 격자 좌표 변환 유틸
 *
 * 위도(lat)·경도(lng) → 기상청 단기예보 격자 좌표(nx, ny) 변환.
 * 기상청 오픈API 활용가이드 수식 기반.
 *
 * @see https://www.data.go.kr/data/15084084/openapi.do
 */

const RE = 6371.00877; // 지구 반경 (km)
const GRID = 5.0; // 격자 간격 (km)
const SLAT1 = 30.0; // 투영 위도 1 (degree)
const SLAT2 = 60.0; // 투영 위도 2 (degree)
const OLON = 126.0; // 기준점 경도 (degree)
const OLAT = 38.0; // 기준점 위도 (degree)
const XO = 43; // 기준점 X 격자
const YO = 136; // 기준점 Y 격자

const DEGRAD = Math.PI / 180.0;
const RADDEG = 180.0 / Math.PI;

function calcConstants() {
  const re = RE / GRID;
  const slat1 = SLAT1 * DEGRAD;
  const slat2 = SLAT2 * DEGRAD;
  const olon = OLON * DEGRAD;
  const olat = OLAT * DEGRAD;

  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);

  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;

  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);

  return { re, sn, sf, ro, olon };
}

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
export function latLngToGrid({ lat, lng }: LatLng): GridXY {
  const { re, sn, sf, ro, olon } = calcConstants();

  const ra = Math.tan(Math.PI * 0.25 + lat * DEGRAD * 0.5);
  const raVal = (re * sf) / Math.pow(ra, sn);

  let theta = lng * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;

  const nx = Math.floor(raVal * Math.sin(theta) + XO + 0.5);
  const ny = Math.floor(ro - raVal * Math.cos(theta) + YO + 0.5);

  return { nx, ny };
}

/**
 * 기상청 격자 좌표 → 위경도 역변환
 */
export function gridToLatLng({ nx, ny }: GridXY): LatLng {
  const { re, sn, sf, ro, olon } = calcConstants();

  const xn = nx - XO;
  const yn = ro - (ny - YO);
  const ra = Math.sqrt(xn * xn + yn * yn);

  let theta = 0;
  if (Math.abs(xn) > 0 || Math.abs(yn) > 0) {
    theta = Math.atan2(xn, yn);
  }

  const alat =
    2.0 * Math.atan(Math.pow((re * sf) / ra, 1.0 / sn)) - Math.PI * 0.5;
  const alon = theta / sn + olon;

  return {
    lat: alat * RADDEG,
    lng: alon * RADDEG,
  };
}
