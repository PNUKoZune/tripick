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
      expect(eta).toEqual({ durationSec: 1200, distanceM: 8500, source: 'otp' });

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
      expect(eta).toEqual({ durationSec: 2400, distanceM: 9200, source: 'otp' });

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
      expect(eta).toEqual({ durationSec: 900, distanceM: 1100, source: 'otp' });

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

  describe('source (폴백이 조용히 섞이지 않도록)', () => {
    it.each([
      ['OTP_BASE_URL 미설정', () => new RouteHelper(config({ OTP_BASE_URL: '' }))],
      [
        'OTP 오류',
        () => {
          mockedAxios.post.mockRejectedValue(new Error('ECONNREFUSED'));
          return new RouteHelper(config({ OTP_BASE_URL: 'http://otp:8090' }));
        },
      ],
      [
        'OTP 경로 없음',
        () => {
          mockedAxios.post.mockResolvedValue({ data: { data: { plan: { itineraries: [] } } } });
          return new RouteHelper(config({ OTP_BASE_URL: 'http://otp:8090' }));
        },
      ],
    ])('%s 이면 source=estimate', async (_label, make) => {
      const eta = await make().getDrivingEta(SEOUL, BUSAN);
      expect(eta.source).toBe('estimate');
    });

    it('실경로면 source=otp', async () => {
      mockedAxios.post.mockResolvedValue(otpResponse(600, [500]));
      const helper = new RouteHelper(config({ OTP_BASE_URL: 'http://otp:8090' }));

      const eta = await helper.getDrivingEta(SEOUL, BUSAN);
      expect(eta.source).toBe('otp');
    });
  });

  describe('폴백 거리 (haversine)', () => {
    // 기존 근사는 경도 1도를 88km 로 고정했는데 이는 위도 37.5°(서울) 전용 값이다.
    // 제주(위도 33.5°)에선 경도 1도가 약 92.8km 라 5% 넘게 어긋난다.
    it('제주 동서 구간을 실제 대권거리(약 55.6km) 오차 2% 내로 계산한다', async () => {
      const helper = new RouteHelper(config({ OTP_BASE_URL: '' }));
      const eta = await helper.getDrivingEta({ lat: 33.5, lng: 126.3 }, { lat: 33.5, lng: 126.9 });

      // 옛 88km/도 근사면 52.8km 가 나와 이 범위를 벗어난다.
      expect(eta.distanceM / 1000).toBeGreaterThan(55.6 * 0.98);
      expect(eta.distanceM / 1000).toBeLessThan(55.6 * 1.02);
    });
  });
});
