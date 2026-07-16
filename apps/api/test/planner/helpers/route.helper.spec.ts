/// <reference types="jest" />

import axios from 'axios';
import { RouteHelper } from '../../../src/planner/helpers/route.helper';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// 캐시 적중/미적중을 실제로 검증하기 위한 인메모리 Redis.
const mockRedisStore = new Map<string, string>();
jest.mock('ioredis', () => ({
  Redis: jest.fn().mockImplementation(() => ({
    get: jest.fn(async (key: string) => mockRedisStore.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      mockRedisStore.set(key, value);
      return 'OK';
    }),
    on: jest.fn(),
    disconnect: jest.fn(),
  })),
}));

const DEPART = new Date('2026-07-15T00:30:00Z'); // 09:30 KST

/** 완료 시점을 수동으로 제어하는 axios 응답 (게이트 점유 테스트용). */
function deferredResponse() {
  let resolve!: (v: unknown) => void;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

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
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisStore.clear();
  });

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

  describe('캐싱', () => {
    const otp = () => new RouteHelper(config({ OTP_BASE_URL: 'http://otp:8090' }));

    it('departAt 이 같은 동일 구간 재조회는 OTP 를 다시 때리지 않는다', async () => {
      mockedAxios.post.mockResolvedValue(otpResponse(1200, [8500]));
      const helper = otp();

      const first = await helper.getTransitEta(SEOUL, BUSAN, DEPART);
      const second = await helper.getTransitEta(SEOUL, BUSAN, DEPART);

      expect(mockedAxios.post).toHaveBeenCalledTimes(1); // 2번째는 캐시 적중
      expect(second).toEqual(first);
    });

    // Live 폴링은 departAt 없이 "현재 시각" 기준이라, 캐싱하면 ETA 가 얼어붙는다.
    it('departAt 이 없으면 캐싱하지 않는다 (Live 폴링 신선도 유지)', async () => {
      mockedAxios.post.mockResolvedValue(otpResponse(1200, [8500]));
      const helper = otp();

      await helper.getTransitEta(SEOUL, BUSAN);
      await helper.getTransitEta(SEOUL, BUSAN);

      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
      expect(mockRedisStore.size).toBe(0);
    });

    it('transit 은 출발 시각이 다르면 따로 조회한다 (시간표 의존)', async () => {
      mockedAxios.post.mockResolvedValue(otpResponse(1200, [8500]));
      const helper = otp();

      await helper.getTransitEta(SEOUL, BUSAN, DEPART);
      await helper.getTransitEta(SEOUL, BUSAN, new Date('2026-07-15T03:30:00Z'));

      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    });

    // OTP 는 CAR 에 교통량 모델이 없어 출발 시각이 결과를 바꾸지 않는다.
    it('car 는 출발 시각이 달라도 캐시를 공유한다', async () => {
      mockedAxios.post.mockResolvedValue(otpResponse(600, [5000]));
      const helper = otp();

      await helper.getDrivingEta(SEOUL, BUSAN, DEPART);
      await helper.getDrivingEta(SEOUL, BUSAN, new Date('2026-07-15T03:30:00Z'));

      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    });

    it('폴백 추정치는 캐싱하지 않는다 (OTP 복구 후 나쁜 값이 남으면 안 됨)', async () => {
      mockedAxios.post.mockRejectedValue(new Error('ECONNREFUSED'));
      const helper = otp();

      const first = await helper.getTransitEta(SEOUL, BUSAN, DEPART);
      expect(first.source).toBe('estimate');
      expect(mockRedisStore.size).toBe(0);

      // OTP 가 살아나면 곧바로 실경로가 나와야 한다 (추정치가 박제되지 않음)
      mockedAxios.post.mockResolvedValue(otpResponse(1200, [8500]));
      const second = await helper.getTransitEta(SEOUL, BUSAN, DEPART);
      expect(second.source).toBe('otp');
      expect(second.durationSec).toBe(1200);
    });

    it('Redis 장애는 조회를 막지 않는다', async () => {
      const { Redis } = jest.requireMock('ioredis') as { Redis: jest.Mock };
      Redis.mockImplementationOnce(() => ({
        get: jest.fn().mockRejectedValue(new Error('redis down')),
        set: jest.fn().mockRejectedValue(new Error('redis down')),
        on: jest.fn(),
        disconnect: jest.fn(),
      }));
      mockedAxios.post.mockResolvedValue(otpResponse(1200, [8500]));

      const eta = await otp().getTransitEta(SEOUL, BUSAN, DEPART);
      expect(eta).toEqual({ durationSec: 1200, distanceM: 8500, source: 'otp' });
    });
  });

  describe('동시성 게이트', () => {
    const otp = () => new RouteHelper(config({ OTP_BASE_URL: 'http://otp:8090' }));

    it('OTP 질의를 동시에 보내지 않는다 (겹치면 OTP 가 붕괴한다)', async () => {
      let inFlight = 0;
      let peak = 0;
      mockedAxios.post.mockImplementation(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setImmediate(r));
        inFlight -= 1;
        return otpResponse(600, [500]);
      });
      const helper = otp();

      // 서로 다른 구간 4건을 동시에 요청 (캐시 적중 없음)
      await Promise.all([
        helper.getTransitEta(SEOUL, { lat: 35.1, lng: 129.0 }, DEPART),
        helper.getTransitEta(SEOUL, { lat: 35.2, lng: 129.1 }, DEPART),
        helper.getTransitEta(SEOUL, { lat: 35.3, lng: 129.2 }, DEPART),
        helper.getTransitEta(SEOUL, { lat: 35.4, lng: 129.3 }, DEPART),
      ]);

      expect(mockedAxios.post).toHaveBeenCalledTimes(4);
      expect(peak).toBe(1); // 직렬화됨
    });

    it('캐시 적중은 게이트에서 대기하지 않는다', async () => {
      mockedAxios.post.mockResolvedValue(otpResponse(600, [500]));
      const helper = otp();
      await helper.getTransitEta(SEOUL, BUSAN, DEPART); // 캐시 적재

      // OTP 질의 1건을 붙잡아 게이트를 점유시킨다.
      const held = deferredResponse();
      mockedAxios.post.mockImplementationOnce(() => held.promise);
      const blocking = helper.getTransitEta(SEOUL, { lat: 36, lng: 128 }, DEPART);

      // 게이트가 점유된 상태에서도 캐시 적중은 즉시 반환돼야 한다.
      const cached = await helper.getTransitEta(SEOUL, BUSAN, DEPART);
      expect(cached.durationSec).toBe(600);

      held.resolve(otpResponse(600, [500]));
      await blocking;
    });

    it('대기 중 다른 호출이 캐싱하면 중복 질의하지 않는다', async () => {
      const held = deferredResponse();
      mockedAxios.post.mockImplementationOnce(() => held.promise);
      mockedAxios.post.mockResolvedValue(otpResponse(600, [500]));
      const helper = otp();

      // 같은 구간 2건이 동시에 들어온다 — 1건은 게이트에서 대기
      const first = helper.getTransitEta(SEOUL, BUSAN, DEPART);
      const second = helper.getTransitEta(SEOUL, BUSAN, DEPART);
      await new Promise((r) => setImmediate(r));

      held.resolve(otpResponse(1200, [8500]));
      const [a, b] = await Promise.all([first, second]);

      expect(a).toEqual(b);
      expect(mockedAxios.post).toHaveBeenCalledTimes(1); // 2번째는 대기 후 캐시 적중
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
