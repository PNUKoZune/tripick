/// <reference types="jest" />

import { latLngToMidRegion, MID_REGIONS } from '../src/mid-region';

describe('latLngToMidRegion', () => {
  it('snaps 서울 시청 좌표를 서울 구역으로', () => {
    const region = latLngToMidRegion({ lat: 37.5665, lng: 126.978 });
    expect(region.name).toBe('서울');
    expect(region.landRegId).toBe('11B00000');
    expect(region.taRegId).toBe('11B10101');
  });

  it('snaps 부산 좌표를 부산·울산·경남 육상구역으로', () => {
    const region = latLngToMidRegion({ lat: 35.1796, lng: 129.0756 });
    expect(region.landRegId).toBe('11H20000');
    expect(region.taRegId).toBe('11H20201');
  });

  it('snaps 제주 좌표를 제주 구역으로', () => {
    const region = latLngToMidRegion({ lat: 33.4996, lng: 126.5312 });
    expect(region.landRegId).toBe('11G00000');
  });

  it('강릉(영동)과 춘천(영서)을 서로 다른 육상구역으로 구분', () => {
    const gangneung = latLngToMidRegion({ lat: 37.7519, lng: 128.8761 });
    const chuncheon = latLngToMidRegion({ lat: 37.8813, lng: 127.73 });
    expect(gangneung.landRegId).toBe('11D20000');
    expect(chuncheon.landRegId).toBe('11D10000');
  });

  it('임의 국내 좌표에도 항상 구역을 반환한다', () => {
    const region = latLngToMidRegion({ lat: 36.0, lng: 128.0 });
    expect(MID_REGIONS).toContainEqual(region);
  });
});
