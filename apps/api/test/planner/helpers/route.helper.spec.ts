/// <reference types="jest" />

import axios from 'axios';
import { RouteHelper } from '../../../src/planner/helpers/route.helper';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/** 지정한 env 만 덮어쓰고 나머지는 호출부 기본값을 돌려주는 ConfigService 스텁. */
function config(overrides: Record<string, string> = {}) {
  return {
    get: <T>(key: string, def?: T) => (key in overrides ? (overrides[key] as unknown as T) : def),
  } as any;
}

const SEOUL = { lat: 37.5665, lng: 126.978 };
const BUSAN = { lat: 35.1796, lng: 129.0756 };

describe('RouteHelper', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('getDrivingEta', () => {
    it('falls back to a local distance estimate when TMAP key is unset', async () => {
      const helper = new RouteHelper(config());
      const eta = await helper.getDrivingEta(SEOUL, BUSAN);

      expect(mockedAxios.post).not.toHaveBeenCalled();
      expect(eta.distanceM).toBeGreaterThan(0);
      expect(eta.durationSec).toBeGreaterThanOrEqual(600); // 최소 10분 보장
    });

    it('returns TMAP totals when the key is set', async () => {
      mockedAxios.post.mockResolvedValue({
        data: { features: [{ properties: { totalTime: 1200, totalDistance: 8500 } }] },
      });
      const helper = new RouteHelper(config({ TMAP_API_KEY: 'k' }));

      const eta = await helper.getDrivingEta(SEOUL, BUSAN);
      expect(eta).toEqual({ durationSec: 1200, distanceM: 8500 });
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    });

    it('falls back to a local estimate when TMAP throws', async () => {
      mockedAxios.post.mockRejectedValue(new Error('502'));
      const helper = new RouteHelper(config({ TMAP_API_KEY: 'k' }));

      const eta = await helper.getDrivingEta(SEOUL, BUSAN);
      expect(eta.distanceM).toBeGreaterThan(0);
      expect(eta.durationSec).toBeGreaterThanOrEqual(600);
    });
  });

  describe('getTransitEta', () => {
    it('falls back to a local estimate when ODsay key is unset', async () => {
      const helper = new RouteHelper(config());
      const eta = await helper.getTransitEta(SEOUL, BUSAN);

      expect(mockedAxios.get).not.toHaveBeenCalled();
      expect(eta.durationSec).toBeGreaterThanOrEqual(600);
    });

    it('normalises ODsay minutes/km into seconds/metres', async () => {
      mockedAxios.get.mockResolvedValue({
        data: { result: { path: [{ info: { totalTime: 40, totalDistance: 12 } }] } },
      });
      const helper = new RouteHelper(config({ ODSAY_API_KEY: 'k' }));

      const eta = await helper.getTransitEta(SEOUL, BUSAN);
      expect(eta).toEqual({ durationSec: 40 * 60, distanceM: 12 * 1000 });
    });
  });
});
