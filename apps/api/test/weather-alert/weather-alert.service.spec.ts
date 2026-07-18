/// <reference types="jest" />

import { WeatherAlertService } from '../../src/weather-alert/weather-alert.service';
import type { ParsedForecast } from '@tripick/utils';

// ioredis 는 실제 연결 없이 동작하도록 인메모리 스텁으로 대체한다.
const redisStore = new Map<string, string>();
jest.mock('ioredis', () => ({
  Redis: jest.fn(() => ({
    on: jest.fn(),
    disconnect: jest.fn(),
    exists: jest.fn(async (key: string) => (redisStore.has(key) ? 1 : 0)),
    set: jest.fn(async (key: string, value: string) => {
      redisStore.set(key, value);
      return 'OK';
    }),
  })),
}));

const NOW = new Date('2026-07-18T09:00:00');

function config() {
  return { get: <T>(_key: string, def?: T) => def } as any;
}

function trip(overrides: Record<string, unknown> = {}) {
  return {
    id: 'trip-1',
    title: '경주 여행',
    status: 'confirmed',
    startDate: '2026-07-19',
    endDate: '2026-07-20',
    ...overrides,
  } as any;
}

function item(day: number, type: string, name: string) {
  return { tripId: 'trip-1', day, type, name, coordinates: { lat: 35.83, lng: 129.21 } } as any;
}

/** 지정 일자에 rainySlots 개의 강수 슬롯을 가진 예보맵을 만든다. */
function forecastMap(date: string, rainySlots: number, probability = 80) {
  const map = new Map<string, ParsedForecast>();
  const times = ['0600', '0900', '1200', '1500', '1800', '2100'];
  times.forEach((time, i) => {
    const rainy = i < rainySlots;
    map.set(`${date}_${time}`, {
      date,
      time,
      temperature: 25,
      precipitationType: rainy ? 1 : 0,
      precipitationProbability: rainy ? probability : 10,
    });
  });
  return map;
}

function build(opts: {
  trips?: any[];
  items?: any[];
  forecasts?: Map<string, ParsedForecast>;
  userIds?: string[];
}) {
  const tripsRepo = { find: jest.fn(async () => opts.trips ?? [trip()]) } as any;
  const itemsRepo = { find: jest.fn(async () => opts.items ?? []) } as any;
  const weatherHelper = {
    getExtendedForecast: jest.fn(async () => opts.forecasts ?? new Map()),
  } as any;
  const inboxService = { create: jest.fn(async () => ({ id: 'n1' })) } as any;
  const tripMembersService = {
    getNotificationTargets: jest.fn(async () => ({
      tripTitle: '경주 여행',
      userIds: opts.userIds ?? ['u1'],
    })),
  } as any;

  const service = new WeatherAlertService(
    tripsRepo,
    itemsRepo,
    weatherHelper,
    inboxService,
    tripMembersService,
    config(),
  );
  return { service, tripsRepo, itemsRepo, weatherHelper, inboxService, tripMembersService };
}

describe('WeatherAlertService', () => {
  beforeEach(() => {
    redisStore.clear();
    jest.clearAllMocks();
  });

  it('비 예보 + 야외 일정이 있는 날에 weather_alert 알림을 보낸다', async () => {
    const { service, inboxService } = build({
      items: [item(1, 'attraction', '불국사')],
      forecasts: forecastMap('20260719', 4),
    });

    const alerted = await service.scanUpcomingTrips(NOW);

    expect(alerted).toBe(1);
    expect(inboxService.create).toHaveBeenCalledTimes(1);
    const dto = inboxService.create.mock.calls[0][0];
    expect(dto.category).toBe('weather_alert');
    expect(dto.userId).toBe('u1');
    expect(dto.payload).toMatchObject({ tripId: 'trip-1', day: '1', date: '2026-07-19' });
    expect(dto.body).toContain('불국사');
  });

  it('자동 재계획을 걸지 않는다 — 알림만 만든다', async () => {
    const { service, inboxService } = build({
      items: [item(1, 'attraction', '불국사')],
      forecasts: forecastMap('20260719', 4),
    });

    await service.scanUpcomingTrips(NOW);

    // 재계획 큐를 주입받지 않는 설계이므로, 부수효과는 인박스 생성뿐이어야 한다.
    expect(inboxService.create).toHaveBeenCalledTimes(1);
  });

  it('강수 슬롯이 임계치(2) 미만이면 알리지 않는다', async () => {
    const { service, inboxService } = build({
      items: [item(1, 'attraction', '불국사')],
      forecasts: forecastMap('20260719', 1),
    });

    expect(await service.scanUpcomingTrips(NOW)).toBe(0);
    expect(inboxService.create).not.toHaveBeenCalled();
  });

  it('야외(attraction) 일정이 없는 날은 알리지 않는다', async () => {
    const { service, inboxService } = build({
      items: [item(1, 'restaurant', '황남밥상'), item(1, 'cafe', '한옥카페')],
      forecasts: forecastMap('20260719', 5),
    });

    expect(await service.scanUpcomingTrips(NOW)).toBe(0);
    expect(inboxService.create).not.toHaveBeenCalled();
  });

  it('같은 (여행, 일자) 는 재알림하지 않는다', async () => {
    const { service, inboxService } = build({
      items: [item(1, 'attraction', '불국사')],
      forecasts: forecastMap('20260719', 4),
    });

    expect(await service.scanUpcomingTrips(NOW)).toBe(1);
    expect(await service.scanUpcomingTrips(NOW)).toBe(0);
    expect(inboxService.create).toHaveBeenCalledTimes(1);
  });

  it('지난 일자는 비 예보가 있어도 건너뛴다', async () => {
    const { service, inboxService } = build({
      trips: [trip({ startDate: '2026-07-17', endDate: '2026-07-19' })],
      items: [item(1, 'attraction', '어제 일정')],
      forecasts: forecastMap('20260717', 6),
    });

    expect(await service.scanUpcomingTrips(NOW)).toBe(0);
    expect(inboxService.create).not.toHaveBeenCalled();
  });

  it('여행 멤버 전원에게 알린다', async () => {
    const { service, inboxService } = build({
      items: [item(1, 'attraction', '불국사')],
      forecasts: forecastMap('20260719', 4),
      userIds: ['u1', 'u2', 'u3'],
    });

    await service.scanUpcomingTrips(NOW);

    expect(inboxService.create).toHaveBeenCalledTimes(3);
  });

  it('예보가 비어 있으면(키 미설정·API 장애) 조용히 넘어간다', async () => {
    const { service, inboxService } = build({
      items: [item(1, 'attraction', '불국사')],
      forecasts: new Map(),
    });

    expect(await service.scanUpcomingTrips(NOW)).toBe(0);
    expect(inboxService.create).not.toHaveBeenCalled();
  });

  it('한 여행의 실패가 나머지 스캔을 막지 않는다', async () => {
    const { service, weatherHelper, inboxService } = build({
      trips: [trip({ id: 'trip-1' }), trip({ id: 'trip-2' })],
      items: [item(1, 'attraction', '불국사')],
    });
    weatherHelper.getExtendedForecast
      .mockRejectedValueOnce(new Error('KMA down'))
      .mockResolvedValueOnce(forecastMap('20260719', 4));

    expect(await service.scanUpcomingTrips(NOW)).toBe(1);
    expect(inboxService.create).toHaveBeenCalledTimes(1);
  });
});
