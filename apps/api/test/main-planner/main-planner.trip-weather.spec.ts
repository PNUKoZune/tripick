/// <reference types="jest" />

import { MainPlannerService } from '../../src/main-planner/main-planner.service';
import type { ParsedForecast } from '@tripick/utils';

/**
 * 날씨를 여행 상세 응답에서 떼어낸 경로를 검증한다.
 * 기상청이 느리거나 막혀도 일정 조회가 그 대기에 묶이지 않아야 하므로,
 * 1) 상세(getTrip)에는 예보가 실리지 않고 기상청을 아예 호출하지 않는다
 * 2) 예보는 getTripWeather 로만 조회되고, 실패해도 "확인 전" 폴백으로 200 을 유지한다
 */
const TRIP = {
  id: 'trip-1',
  userId: 'u1',
  title: '경주여행',
  destination: '경주',
  startDate: '2026-07-10',
  endDate: '2026-07-11',
  transportMode: 'car',
  status: 'confirmed',
};

const ITEMS = [
  { id: 'i1', tripId: 'trip-1', day: 1, order: 1, name: '불국사', type: 'sight', coordinates: { lat: 35.79, lng: 129.33 }, travelTimeMin: 20 },
  { id: 'i2', tripId: 'trip-1', day: 2, order: 1, name: '대릉원', type: 'sight', coordinates: { lat: 35.84, lng: 129.21 }, travelTimeMin: 15 },
];

/** 7/10 낮 맑음(강수확률 20%) 한 슬롯 — 1일차만 실데이터, 2일차는 예보 없음 */
function forecastFixture(): Map<string, ParsedForecast> {
  return new Map<string, ParsedForecast>([
    ['20260710-1500', { date: '20260710', time: '1500', temperature: 29, precipitationProbability: 20, skyCondition: 1 }],
  ]);
}

function setup(opts: { forecast?: Map<string, ParsedForecast>; forecastError?: Error } = {}) {
  const getExtendedForecast = jest.fn();
  if (opts.forecastError) getExtendedForecast.mockRejectedValue(opts.forecastError);
  else getExtendedForecast.mockResolvedValue(opts.forecast ?? new Map());

  const noop = {} as never;
  const service = new MainPlannerService(
    noop, // tripsRepo
    { find: jest.fn().mockResolvedValue(ITEMS) } as never, // itemsRepo
    { findOneForViewer: jest.fn().mockResolvedValue(TRIP) } as never, // tripsService
    { findAll: jest.fn().mockResolvedValue([]) } as never, // tripMembersService
    noop, // friendsService
    { findByUser: jest.fn().mockResolvedValue(null) } as never, // preferencesService
    noop, // inboxService
    { getExtendedForecast } as never, // weatherHelper
    noop, // kakaoLocal
    noop, // placeRetrieval
    noop, // placeEmbeddings
    noop, // tourApi
    noop, // routeHelper
    noop, // groupPreferences (날씨 조회 경로에서는 사용 안 함)
  );
  return { service, user: { id: 'u1' } as never, getExtendedForecast };
}

describe('MainPlannerService — 날씨 분리', () => {
  describe('getTrip (여행 상세)', () => {
    it('응답 meta 에 weather 를 싣지 않는다', async () => {
      const { service, user } = setup({ forecast: forecastFixture() });

      const trip = await service.getTrip(user, 'trip-1');

      expect(trip.meta).not.toHaveProperty('weather');
      // 일정 데이터는 그대로 — 분리가 다른 필드를 건드리지 않았다
      expect(trip.items).toHaveLength(2);
      expect(trip.days).toHaveLength(2);
    });

    it('기상청을 아예 호출하지 않는다 (예보 대기에 묶이지 않는 근거)', async () => {
      const { service, user, getExtendedForecast } = setup({ forecast: forecastFixture() });

      await service.getTrip(user, 'trip-1');

      expect(getExtendedForecast).not.toHaveBeenCalled();
    });
  });

  describe('getTripWeather (분리된 지연 로드)', () => {
    it('예보가 있는 일자는 실데이터로, 없는 일자는 "확인 전" 폴백으로 채운다', async () => {
      const { service, user, getExtendedForecast } = setup({ forecast: forecastFixture() });

      const weather = await service.getTripWeather(user, 'trip-1');

      expect(getExtendedForecast).toHaveBeenCalledTimes(1);
      expect(weather).toHaveLength(2);
      expect(weather[0]).toMatchObject({
        day: 1,
        emoji: '☀️',
        tempLabel: '29° / 29°',
        precipitationProbability: 20,
        forecasted: true,
      });
      expect(weather[1]).toMatchObject({ day: 2, forecasted: false, tempLabel: '-' });
      expect(weather[1]!.label).toContain('확인 전');
    });

    it('일정 항목 좌표 평균을 조회 좌표로 쓴다 (상세 지도 중심과 같은 기준)', async () => {
      const { service, user, getExtendedForecast } = setup({ forecast: forecastFixture() });

      await service.getTripWeather(user, 'trip-1');

      expect(getExtendedForecast).toHaveBeenCalledWith((35.79 + 35.84) / 2, (129.33 + 129.21) / 2);
    });

    it('기상청 조회가 실패해도 던지지 않고 전 일자 폴백을 반환한다', async () => {
      const { service, user } = setup({ forecastError: new Error('timeout of 10000ms exceeded') });

      const weather = await service.getTripWeather(user, 'trip-1');

      expect(weather).toHaveLength(2);
      expect(weather.every((w) => !w.forecasted)).toBe(true);
    });

    it('예보가 비어 있으면(키 미설정·장애 마킹) 전 일자 폴백을 반환한다', async () => {
      const { service, user } = setup({ forecast: new Map() });

      const weather = await service.getTripWeather(user, 'trip-1');

      expect(weather.every((w) => !w.forecasted)).toBe(true);
    });
  });
});
