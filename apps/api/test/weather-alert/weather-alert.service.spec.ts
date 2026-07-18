/// <reference types="jest" />

import { WeatherAlertService } from '../../src/weather-alert/weather-alert.service';
import type { ParsedForecast } from '@tripick/utils';

// ioredis 는 실제 연결 없이 동작하도록 인메모리 스텁으로 대체한다.
// SET 은 NX 플래그를 실제 Redis 와 같게 흉내낸다(이미 있으면 null) — 중복 억제가
// 선점(SET NX)에 의존하므로 여기서 대충 넘기면 테스트가 계약을 못 지킨다.
const redisStore = new Map<string, string>();
jest.mock('ioredis', () => ({
  Redis: jest.fn(() => ({
    on: jest.fn(),
    connect: jest.fn(async () => undefined),
    disconnect: jest.fn(),
    set: jest.fn(async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && redisStore.has(key)) return null;
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

function item(day: number, type: string, name: string, lat = 35.83, lng = 129.21) {
  return { tripId: 'trip-1', day, type, name, coordinates: { lat, lng } } as any;
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

  it('오늘 판정을 KST 로 한다 — 서버가 UTC 여도 끝난 날을 알리지 않는다', async () => {
    // 2026-07-18T15:30Z = KST 2026-07-19 00:30. 한국에선 18일이 이미 끝났다.
    // 서버 로컬 TZ(UTC)로 today 를 뽑으면 18일을 "오늘"로 보고 잘못 알린다.
    const { service, inboxService } = build({
      trips: [trip({ startDate: '2026-07-18', endDate: '2026-07-18' })],
      items: [item(1, 'attraction', '끝난 일정')],
      forecasts: forecastMap('20260718', 6),
    });

    const alerted = await service.scanUpcomingTrips(new Date('2026-07-18T15:30:00Z'));

    expect(alerted).toBe(0);
    expect(inboxService.create).not.toHaveBeenCalled();
  });

  it('일차별 좌표로 예보를 조회한다 — 여행 평균 좌표로 뭉개지 않는다', async () => {
    const { service, weatherHelper, inboxService } = build({
      items: [item(1, 'attraction', '경복궁', 37.5796, 126.977), item(2, 'attraction', '해운대', 35.1587, 129.16)],
    });
    // 부산(위도 36 미만)만 비, 서울은 맑음
    weatherHelper.getExtendedForecast.mockImplementation(async (lat: number) =>
      lat < 36 ? forecastMap('20260720', 5) : new Map(),
    );

    const alerted = await service.scanUpcomingTrips(NOW);

    // 일차별로 좌표가 달라 조회가 2회 나뉘고, 비가 오는 부산 일차만 알린다
    expect(weatherHelper.getExtendedForecast).toHaveBeenCalledTimes(2);
    expect(alerted).toBe(1);
    expect(inboxService.create.mock.calls[0][0].body).toContain('해운대');
  });

  it('발송 실패 시에도 선점한 키를 유지해 재시도가 중복 발송하지 않는다', async () => {
    const { service, inboxService } = build({
      items: [item(1, 'attraction', '불국사')],
      forecasts: forecastMap('20260719', 4),
    });
    inboxService.create.mockRejectedValueOnce(new Error('inbox down'));

    expect(await service.scanUpcomingTrips(NOW)).toBe(0);
    expect(inboxService.create).toHaveBeenCalledTimes(1);

    // 재시도: 이미 선점된 키라 다시 보내지 않는다
    expect(await service.scanUpcomingTrips(NOW)).toBe(0);
    expect(inboxService.create).toHaveBeenCalledTimes(1);
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
