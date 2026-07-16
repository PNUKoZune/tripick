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

/** OTP GraphQL plan 응답 형태를 만든다. */
function otpResponse(durationSec: number, legDistancesM: number[]) {
  return {
    data: {
      data: {
        plan: {
          itineraries: [
            { duration: durationSec, legs: legDistancesM.map((distance) => ({ distance })) },
          ],
        },
      },
    },
  };
}

describe('RouteHelper', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('getDrivingEta', () => {
    it('falls back to a local distance estimate when OTP_BASE_URL is unset', async () => {
      const helper = new RouteHelper(config({ OTP_BASE_URL: '' }));
      const eta = await helper.getDrivingEta(SEOUL, BUSAN);

      expect(mockedAxios.post).not.toHaveBeenCalled();
      expect(eta.distanceM).toBeGreaterThan(0);
      expect(eta.durationSec).toBeGreaterThanOrEqual(600); // 최소 10분 보장
    });

    it('returns OTP duration and summed leg distance for a CAR plan', async () => {
      mockedAxios.post.mockResolvedValue(otpResponse(1200, [5000, 3500]));
      const helper = new RouteHelper(config({ OTP_BASE_URL: 'http://otp:8090' }));

      const eta = await helper.getDrivingEta(SEOUL, BUSAN);
      expect(eta).toEqual({ durationSec: 1200, distanceM: 8500 });

      const [url, body] = mockedAxios.post.mock.calls[0]!;
      expect(url).toBe('http://otp:8090/otp/gtfs/v1');
      expect((body as { query: string }).query).toContain('mode: CAR');
    });

    it('falls back to a local estimate when OTP throws', async () => {
      mockedAxios.post.mockRejectedValue(new Error('ECONNREFUSED'));
      const helper = new RouteHelper(config({ OTP_BASE_URL: 'http://otp:8090' }));

      const eta = await helper.getDrivingEta(SEOUL, BUSAN);
      expect(eta.distanceM).toBeGreaterThan(0);
      expect(eta.durationSec).toBeGreaterThanOrEqual(600);
    });

    it('falls back to a local estimate when OTP returns no itinerary', async () => {
      mockedAxios.post.mockResolvedValue({ data: { data: { plan: { itineraries: [] } } } });
      const helper = new RouteHelper(config({ OTP_BASE_URL: 'http://otp:8090' }));

      const eta = await helper.getDrivingEta(SEOUL, BUSAN);
      expect(eta.durationSec).toBeGreaterThanOrEqual(600);
    });
  });

  describe('getTransitEta', () => {
    it('requests TRANSIT+WALK modes and returns OTP totals', async () => {
      mockedAxios.post.mockResolvedValue(otpResponse(2400, [600, 8200, 400]));
      const helper = new RouteHelper(config({ OTP_BASE_URL: 'http://otp:8090' }));

      const eta = await helper.getTransitEta(SEOUL, BUSAN);
      expect(eta).toEqual({ durationSec: 2400, distanceM: 9200 });

      const [, body] = mockedAxios.post.mock.calls[0]!;
      const query = (body as { query: string }).query;
      expect(query).toContain('mode: TRANSIT');
      expect(query).toContain('mode: WALK');
    });

    it('falls back to a local estimate when OTP_BASE_URL is unset', async () => {
      const helper = new RouteHelper(config({ OTP_BASE_URL: '' }));
      const eta = await helper.getTransitEta(SEOUL, BUSAN);

      expect(mockedAxios.post).not.toHaveBeenCalled();
      expect(eta.durationSec).toBeGreaterThanOrEqual(600);
    });

    it('passes the planned departure time (KST date/time) to OTP', async () => {
      mockedAxios.post.mockResolvedValue(otpResponse(1000, [1000]));
      const helper = new RouteHelper(config({ OTP_BASE_URL: 'http://otp:8090' }));

      // 2026-07-15 09:30 KST == 2026-07-15T00:30:00Z
      await helper.getTransitEta(SEOUL, BUSAN, new Date('2026-07-15T00:30:00Z'));

      const query = (mockedAxios.post.mock.calls[0]![1] as { query: string }).query;
      expect(query).toContain('date: "2026-07-15"');
      expect(query).toContain('time: "09:30"');
    });

    it('omits date/time when no departure time is given', async () => {
      mockedAxios.post.mockResolvedValue(otpResponse(1000, [1000]));
      const helper = new RouteHelper(config({ OTP_BASE_URL: 'http://otp:8090' }));

      await helper.getTransitEta(SEOUL, BUSAN);

      const query = (mockedAxios.post.mock.calls[0]![1] as { query: string }).query;
      expect(query).not.toContain('date:');
      expect(query).not.toContain('time:');
    });
  });

  describe('getWalkingEta', () => {
    it('requests WALK-only mode', async () => {
      mockedAxios.post.mockResolvedValue(otpResponse(900, [1100]));
      const helper = new RouteHelper(config({ OTP_BASE_URL: 'http://otp:8090' }));

      const eta = await helper.getWalkingEta(SEOUL, BUSAN);
      expect(eta).toEqual({ durationSec: 900, distanceM: 1100 });

      const query = (mockedAxios.post.mock.calls[0]![1] as { query: string }).query;
      expect(query).toContain('mode: WALK');
      expect(query).not.toContain('mode: TRANSIT');
    });
  });

  describe('getEta', () => {
    // 표시용 라벨이 아닌 정본 mode 로 분기하는지 — walk 가 transit 으로 붕괴되면 안 된다.
    it.each([
      ['car', 'mode: CAR'],
      ['transit', 'mode: TRANSIT'],
      ['walk', 'mode: WALK'],
    ] as const)('dispatches %s to the matching OTP mode', async (mode, expected) => {
      mockedAxios.post.mockResolvedValue(otpResponse(600, [500]));
      const helper = new RouteHelper(config({ OTP_BASE_URL: 'http://otp:8090' }));

      await helper.getEta(SEOUL, BUSAN, mode);

      const query = (mockedAxios.post.mock.calls[0]![1] as { query: string }).query;
      expect(query).toContain(expected);
    });

    it('does not route walk through TRANSIT', async () => {
      mockedAxios.post.mockResolvedValue(otpResponse(600, [500]));
      const helper = new RouteHelper(config({ OTP_BASE_URL: 'http://otp:8090' }));

      await helper.getEta(SEOUL, BUSAN, 'walk');

      const query = (mockedAxios.post.mock.calls[0]![1] as { query: string }).query;
      expect(query).not.toContain('TRANSIT');
    });
  });
});
