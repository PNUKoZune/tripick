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

/** ODsay 는 Referer 가 있어야 인증되므로 두 env 가 모두 있어야 호출까지 간다. */
const ODSAY_ENV = { ODSAY_API_KEY: 'k', ODSAY_SERVICE_URL: 'http://localhost:4000' };

describe('RouteHelper', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('getDrivingEta', () => {
    it('falls back to a local distance estimate when the Kakao key is unset', async () => {
      const helper = new RouteHelper(config());
      const eta = await helper.getDrivingEta(SEOUL, BUSAN);

      expect(mockedAxios.get).not.toHaveBeenCalled();
      expect(eta.distanceM).toBeGreaterThan(0);
      expect(eta.durationSec).toBeGreaterThanOrEqual(600); // 최소 10분 보장
    });

    it('returns Kakao summary totals as-is (already seconds/metres)', async () => {
      mockedAxios.get.mockResolvedValue({
        data: { routes: [{ result_code: 0, result_msg: '길찾기 성공', summary: { duration: 1989, distance: 10240 } }] },
      });
      const helper = new RouteHelper(config({ KAKAO_REST_API_KEY: 'k' }));

      const eta = await helper.getDrivingEta(SEOUL, BUSAN);
      expect(eta).toEqual({ durationSec: 1989, distanceM: 10240 });
    });

    it('sends coordinates as x,y (lng,lat) with the KakaoAK auth header', async () => {
      mockedAxios.get.mockResolvedValue({
        data: { routes: [{ result_code: 0, summary: { duration: 10, distance: 20 } }] },
      });
      const helper = new RouteHelper(config({ KAKAO_REST_API_KEY: 'k' }));

      await helper.getDrivingEta(SEOUL, BUSAN);
      const [, options] = mockedAxios.get.mock.calls[0]!;
      expect(options?.params.origin).toBe(`${SEOUL.lng},${SEOUL.lat}`);
      expect(options?.params.destination).toBe(`${BUSAN.lng},${BUSAN.lat}`);
      expect(options?.headers?.Authorization).toBe('KakaoAK k');
    });

    it('treats a non-zero result_code as a failure and falls back', async () => {
      // 길찾기 실패는 HTTP 200 으로 오므로 catch 로는 안 잡힌다.
      mockedAxios.get.mockResolvedValue({
        data: { routes: [{ result_code: 103, result_msg: '도착지 주변의 도로를 찾을 수 없습니다' }] },
      });
      const helper = new RouteHelper(config({ KAKAO_REST_API_KEY: 'k' }));

      const eta = await helper.getDrivingEta(SEOUL, BUSAN);
      expect(eta.durationSec).toBeGreaterThanOrEqual(600);
    });

    it('reports zero travel when origin and destination are within 5m (104)', async () => {
      mockedAxios.get.mockResolvedValue({
        data: { routes: [{ result_code: 104, result_msg: '출발지와 도착지가 너무 가깝습니다' }] },
      });
      const helper = new RouteHelper(config({ KAKAO_REST_API_KEY: 'k' }));

      // 같은 자리인데 폴백의 최소 10분을 씌우면 일정에 없는 이동이 생긴다.
      expect(await helper.getDrivingEta(SEOUL, SEOUL)).toEqual({ durationSec: 0, distanceM: 0 });
    });

    it('falls back to a local estimate when Kakao throws', async () => {
      mockedAxios.get.mockRejectedValue(new Error('502'));
      const helper = new RouteHelper(config({ KAKAO_REST_API_KEY: 'k' }));

      const eta = await helper.getDrivingEta(SEOUL, BUSAN);
      expect(eta.distanceM).toBeGreaterThan(0);
      expect(eta.durationSec).toBeGreaterThanOrEqual(600);
    });
  });

  describe('getTransitEta', () => {
    it('falls back to a local estimate when the ODsay key is unset', async () => {
      const helper = new RouteHelper(config());
      const eta = await helper.getTransitEta(SEOUL, BUSAN);

      expect(mockedAxios.get).not.toHaveBeenCalled();
      expect(eta.durationSec).toBeGreaterThanOrEqual(600);
    });

    it('skips the call when ODSAY_SERVICE_URL is unset, since auth would fail', async () => {
      const helper = new RouteHelper(config({ ODSAY_API_KEY: 'k' }));
      const eta = await helper.getTransitEta(SEOUL, BUSAN);

      expect(mockedAxios.get).not.toHaveBeenCalled();
      expect(eta.durationSec).toBeGreaterThanOrEqual(600);
    });

    it('converts totalTime to seconds and keeps totalDistance in metres', async () => {
      mockedAxios.get.mockResolvedValue({
        data: { result: { path: [{ info: { totalTime: 40, totalDistance: 10764 } }] } },
      });
      const helper = new RouteHelper(config(ODSAY_ENV));

      const eta = await helper.getTransitEta(SEOUL, BUSAN);
      expect(eta).toEqual({ durationSec: 40 * 60, distanceM: 10764 });
    });

    it('sends the registered service URL as the Referer header', async () => {
      mockedAxios.get.mockResolvedValue({
        data: { result: { path: [{ info: { totalTime: 1, totalDistance: 1 } }] } },
      });
      const helper = new RouteHelper(config(ODSAY_ENV));

      await helper.getTransitEta(SEOUL, BUSAN);
      const [, options] = mockedAxios.get.mock.calls[0]!;
      expect(options?.headers?.Referer).toBe('http://localhost:4000');
    });

    it('treats a 200 response carrying an error array as a failure', async () => {
      // ODsay 는 인증 실패도 HTTP 200 + error 배열로 준다.
      mockedAxios.get.mockResolvedValue({
        data: { error: [{ code: '500', message: '[ApiKeyAuthFailed] ApiKey authentication failed.' }] },
      });
      const helper = new RouteHelper(config(ODSAY_ENV));

      const eta = await helper.getTransitEta(SEOUL, BUSAN);
      expect(eta.durationSec).toBeGreaterThanOrEqual(600);
    });

    it('falls back when ODsay returns no path', async () => {
      mockedAxios.get.mockResolvedValue({ data: { result: { path: [] } } });
      const helper = new RouteHelper(config(ODSAY_ENV));

      const eta = await helper.getTransitEta(SEOUL, BUSAN);
      expect(eta.durationSec).toBeGreaterThanOrEqual(600);
    });
  });
});
