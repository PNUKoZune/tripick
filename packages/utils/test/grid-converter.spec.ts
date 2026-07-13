/// <reference types="jest" />

import { latLngToGrid, gridToLatLng } from '../src/grid-converter';

describe('latLngToGrid', () => {
  it('converts Seoul city hall to the documented grid cell', () => {
    expect(latLngToGrid({ lat: 37.5665, lng: 126.978 })).toEqual({ nx: 60, ny: 127 });
  });

  it('converts Busan Gwangalli to a southern grid cell', () => {
    const { nx, ny } = latLngToGrid({ lat: 35.1532, lng: 129.1185 });
    // 부산은 서울보다 동쪽(nx 큼)·남쪽(ny 작음)에 위치한다.
    expect(nx).toBeGreaterThan(60);
    expect(ny).toBeLessThan(127);
  });

  it('returns integer grid coordinates', () => {
    const { nx, ny } = latLngToGrid({ lat: 33.4996, lng: 126.5312 }); // 제주
    expect(Number.isInteger(nx)).toBe(true);
    expect(Number.isInteger(ny)).toBe(true);
  });
});

describe('gridToLatLng round-trip', () => {
  it('recovers the original coordinate within one grid cell (~5km)', () => {
    const origin = { lat: 37.5665, lng: 126.978 };
    const grid = latLngToGrid(origin);
    const back = gridToLatLng(grid);

    // 격자→위경도는 셀 중심을 반환하므로 원점과 0.05도(약 5km) 이내면 정상.
    expect(Math.abs(back.lat - origin.lat)).toBeLessThan(0.05);
    expect(Math.abs(back.lng - origin.lng)).toBeLessThan(0.05);
  });
});
