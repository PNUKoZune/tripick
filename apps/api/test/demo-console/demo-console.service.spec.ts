/// <reference types="jest" />

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DemoConsoleService } from '../../src/demo-console/demo-console.service';
import {
  DemoConcentrationSource,
  DemoForecastSource,
} from '../../src/demo-console/demo-alert-sources';
import { DEMO_TRIP_TITLE } from '../../src/demo-console/demo-console.constants';
import { DEMO_PLACES } from '../../src/demo-console/demo-trip.fixture';
import {
  ARRIVAL_GRACE_MIN,
  ARRIVAL_LATE_LIMIT_MIN,
  arrivalDedupeKey,
  liveLocationKey,
} from '../../src/arrival-alert/arrival-alert.constants';
import { weatherDedupeKey } from '../../src/weather-alert/weather-alert.constants';
import { crowdDedupeKey } from '../../src/crowd-alert/crowd-alert.constants';
import {
  CROWD_MIN_RATE,
  CROWD_RELATIVE_MULTIPLIER,
} from '../../src/crowd-alert/crowd-alert.constants';

// 콘솔은 Redis 를 중복 억제 키 해제에만 쓴다 — 삭제된 키를 확인할 수 있게 인메모리로 대체한다.
const deleted: string[] = [];
jest.mock('ioredis', () => ({
  Redis: jest.fn(() => ({
    on: jest.fn(),
    connect: jest.fn(async () => undefined),
    disconnect: jest.fn(),
    del: jest.fn(async (...keys: string[]) => {
      deleted.push(...keys);
      return keys.length;
    }),
  })),
}));

/** 2026-09-27 14:00 KST — 시연을 오후에 한다고 보고 고정한다. */
const NOW = new Date('2026-09-27T05:00:00Z');
const TODAY = '2026-09-27';

const user = { id: 'u1', email: 'demo@tripick.place', nickname: '발표자' } as any;

function trip(overrides: Record<string, unknown> = {}) {
  return {
    id: 'trip-1',
    userId: 'u1',
    title: DEMO_TRIP_TITLE,
    status: 'in_progress',
    startDate: TODAY,
    endDate: TODAY,
    ...overrides,
  } as any;
}

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    tripId: 'trip-1',
    day: 1,
    order: 1,
    type: 'attraction',
    name: '성수 서울숲',
    address: '서울 성동구 뚝섬로 273',
    coordinates: { lat: 37.5446, lng: 127.0375 },
    scheduledAt: new Date(NOW.getTime() - 20 * 60_000),
    durationMin: 90,
    ...overrides,
  } as any;
}

function build(opts: { trip?: any; items?: any[]; arrivalAlerted?: number } = {}) {
  const saved: any[] = [];
  const tripsRepo = {
    findOneBy: jest.fn(async () => opts.trip ?? trip()),
    findOne: jest.fn(async () => opts.trip ?? trip()),
    find: jest.fn(async () => [opts.trip ?? trip()]),
    delete: jest.fn(async () => ({ affected: 1 })),
    create: jest.fn((value: any) => value),
    save: jest.fn(async (value: any) => ({ id: 'trip-seeded', ...value })),
  } as any;
  const itemsRepo = {
    find: jest.fn(async () => opts.items ?? [item()]),
    create: jest.fn((value: any) => value),
    save: jest.fn(async (value: any) => {
      saved.push(value);
      return value;
    }),
  } as any;
  const liveLocation = {
    record: jest.fn(async () => undefined),
    getFresh: jest.fn(async () => null),
  } as any;
  const arrivalAlert = {
    scanDueItems: jest.fn(async () => opts.arrivalAlerted ?? 1),
  } as any;
  const weatherAlert = { scanUpcomingTrips: jest.fn(async () => 1) } as any;
  const crowdAlert = { scanUpcomingTrips: jest.fn(async () => 1) } as any;
  const forecastSource = new DemoForecastSource();
  const concentrationSource = new DemoConcentrationSource();
  const config = { get: <T>(_key: string, def?: T) => def } as any;

  const service = new DemoConsoleService(
    tripsRepo,
    itemsRepo,
    liveLocation,
    arrivalAlert,
    weatherAlert,
    crowdAlert,
    forecastSource,
    concentrationSource,
    config,
  );

  return {
    service,
    tripsRepo,
    itemsRepo,
    liveLocation,
    arrivalAlert,
    weatherAlert,
    crowdAlert,
    forecastSource,
    concentrationSource,
    saved,
  };
}

/** 미도착 판정 창(시작+유예 ~ 지각 상한) 안의 시각인지 — 스캐너와 같은 계산. */
function inDueWindow(at: Date): boolean {
  const upper = NOW.getTime() - ARRIVAL_GRACE_MIN * 60_000;
  const lower = upper - ARRIVAL_LATE_LIMIT_MIN * 60_000;
  return at.getTime() >= lower && at.getTime() <= upper;
}

describe('DemoConsoleService', () => {
  beforeEach(() => {
    deleted.length = 0;
    jest.clearAllMocks();
  });

  describe('시연용 여행 시드', () => {
    it('오늘 당일 여행과 일정을 만들고, 한 항목이 미도착 판정 창에 들어온다', async () => {
      const { service, itemsRepo } = build();

      await service.seedTrip(user, NOW);

      const items = itemsRepo.save.mock.calls[0][0];
      expect(items).toHaveLength(DEMO_PLACES.length);
      expect(items.filter((i: any) => inDueWindow(i.scheduledAt))).toHaveLength(1);
    });

    it('같은 제목의 기존 시드를 지우고 다시 만든다(멱등)', async () => {
      const { service, tripsRepo } = build();

      await service.seedTrip(user, NOW);

      expect(tripsRepo.delete).toHaveBeenCalledWith({ userId: 'u1', title: DEMO_TRIP_TITLE });
    });

    it('일정 간격은 기준 시각표 그대로 유지한다', async () => {
      const { service, itemsRepo } = build();

      await service.seedTrip(user, NOW);

      const items = itemsRepo.save.mock.calls[0][0];
      const gapMin = (items[1].scheduledAt - items[0].scheduledAt) / 60_000;
      const baseGap =
        (DEMO_PLACES[1]!.hour - DEMO_PLACES[0]!.hour) * 60 +
        (DEMO_PLACES[1]!.minute - DEMO_PLACES[0]!.minute);
      expect(gapMin).toBe(baseGap);
    });
  });

  describe('미도착 시나리오', () => {
    it('일정 좌표 밖 위치를 주입하고 실제 미도착 스캔을 돌린다', async () => {
      const { service, liveLocation, arrivalAlert } = build();

      const result = await service.runArrival(user, { distanceKm: 3 }, NOW);

      const injected = liveLocation.record.mock.calls[0][1];
      // 위도 1도 ≈ 111.32km — 3km 를 북쪽으로 민 만큼만 벌어져야 한다.
      expect(injected.lat - 37.5446).toBeCloseTo(3 / 111.32, 4);
      expect(injected.lng).toBe(127.0375);
      expect(arrivalAlert.scanDueItems).toHaveBeenCalledWith(NOW, { tripIds: ['trip-1'] });
      expect(result).toMatchObject({ scenario: 'arrival', alerted: 1 });
    });

    it('재시연을 위해 (여행,사용자,일차) 중복 억제 키를 먼저 지운다', async () => {
      const { service } = build();

      await service.runArrival(user, {}, NOW);

      expect(deleted).toContain(arrivalDedupeKey('trip-1', 'u1', 1));
    });

    it('판정 창에 든 항목이 이미 있으면 일정 시각을 건드리지 않는다', async () => {
      const { service, itemsRepo } = build();

      await service.runArrival(user, {}, NOW);

      expect(itemsRepo.save).not.toHaveBeenCalled();
    });

    it('판정 창에 든 항목이 없으면 가장 가까운 항목을 창 안으로 옮긴다', async () => {
      const far = item({ scheduledAt: new Date(NOW.getTime() + 3 * 60 * 60_000) });
      const { service, itemsRepo } = build({ items: [far] });

      await service.runArrival(user, {}, NOW);

      const moved = itemsRepo.save.mock.calls[0][0];
      expect(inDueWindow(moved.scheduledAt)).toBe(true);
    });

    it('좌표가 없는 일정뿐이면 판정할 수 없다고 알린다', async () => {
      const { service } = build({ items: [item({ coordinates: null })] });

      await expect(service.runArrival(user, {}, NOW)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('날씨·혼잡 시나리오', () => {
    it('대상 일자에만 강수 예보를 주입하고 그 여행만 스캔한다', async () => {
      const { service, weatherAlert, forecastSource } = build();

      await service.runWeather(user, {}, NOW);

      expect(weatherAlert.scanUpcomingTrips).toHaveBeenCalledWith(NOW, { tripIds: ['trip-1'] });
      const forecasts = await forecastSource.getExtendedForecast(37.5, 127);
      const dates = new Set([...forecasts.values()].map((f) => f.date));
      expect([...dates]).toEqual(['20260927']);
      expect(deleted).toContain(weatherDedupeKey('trip-1', TODAY));
    });

    it('집중률은 대상 일자만 평균 대비 임계를 넘게 주입한다', async () => {
      const { service, concentrationSource } = build();

      await service.runCrowd(user, {}, NOW);

      const lookup = await concentrationSource.fetchConcentration('11', '11200', '성수 서울숲');
      expect(lookup.ok).toBe(true);
      if (!lookup.ok) return;
      const target = lookup.series.ratesByYmd.get('20260927')!;
      const other = lookup.series.ratesByYmd.get('20260928')!;
      expect(target).toBeGreaterThanOrEqual(lookup.series.mean * CROWD_RELATIVE_MULTIPLIER);
      expect(target).toBeGreaterThanOrEqual(CROWD_MIN_RATE);
      expect(other).toBeLessThan(lookup.series.mean * CROWD_RELATIVE_MULTIPLIER);
      expect(deleted).toContain(crowdDedupeKey('trip-1', TODAY));
    });

    it('스캐너가 보지 않는 상태(draft)면 이유를 알려주고 스캔하지 않는다', async () => {
      const { service, weatherAlert } = build({ trip: trip({ status: 'draft' }) });

      await expect(service.runWeather(user, {}, NOW)).rejects.toBeInstanceOf(BadRequestException);
      expect(weatherAlert.scanUpcomingTrips).not.toHaveBeenCalled();
    });

    it('대상 일차에 관광지 일정이 없으면 혼잡 알림이 안 나갈 것을 미리 알린다', async () => {
      const { service, crowdAlert } = build({ items: [item({ type: 'cafe' })] });

      await expect(service.runCrowd(user, {}, NOW)).rejects.toBeInstanceOf(BadRequestException);
      expect(crowdAlert.scanUpcomingTrips).not.toHaveBeenCalled();
    });

    it('시연 대상 여행이 없으면 시드부터 하라고 알린다', async () => {
      const { service, tripsRepo } = build();
      tripsRepo.findOneBy.mockResolvedValue(null);
      tripsRepo.findOne.mockResolvedValue(null);

      await expect(service.runWeather(user, {}, NOW)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('대상 선택', () => {
    it('상태 조회는 고를 수 있는 여행 목록을 함께 준다', async () => {
      const { service } = build();

      const status = await service.status(user, {}, NOW);

      expect(status.trips).toEqual([
        expect.objectContaining({ tripId: 'trip-1', seeded: true, scannable: true, days: 1 }),
      ]);
    });

    it('스캐너가 보지 않는 상태도 목록에 남기고 scannable=false 로 알린다', async () => {
      const { service } = build({ trip: trip({ status: 'draft', title: '심사위원 여행' }) });

      const status = await service.status(user, {}, NOW);

      expect(status.trips[0]).toMatchObject({ seeded: false, scannable: false });
    });

    it('tripId 를 주면 시드 여행 대신 그 여행을 대상으로 삼는다', async () => {
      const { service, tripsRepo } = build({
        trip: trip({ id: 'trip-judge', title: '심사위원이 만든 여행' }),
      });

      const result = await service.runWeather(user, { tripId: 'trip-judge' }, NOW);

      expect(tripsRepo.findOneBy).toHaveBeenCalledWith({ id: 'trip-judge', userId: 'u1' });
      expect(result.tripId).toBe('trip-judge');
    });

    it('예보 구간(오늘 +10일) 밖 일자는 0건 대신 이유를 알려준다', async () => {
      const far = '2026-11-01';
      const { service, weatherAlert } = build({ trip: trip({ startDate: far, endDate: far }) });

      await expect(service.runWeather(user, {}, NOW)).rejects.toBeInstanceOf(BadRequestException);
      expect(weatherAlert.scanUpcomingTrips).not.toHaveBeenCalled();
    });
  });

  describe('초기화', () => {
    it('주입 위치와 세 알림의 중복 억제 키를 함께 지운다', async () => {
      const { service } = build();

      await service.reset(user, NOW);

      expect(deleted).toEqual(
        expect.arrayContaining([
          liveLocationKey('u1'),
          arrivalDedupeKey('trip-1', 'u1', 1),
          weatherDedupeKey('trip-1', TODAY),
          crowdDedupeKey('trip-1', TODAY),
        ]),
      );
    });
  });
});
