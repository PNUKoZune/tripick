/// <reference types="jest" />

import { placeExposure, rainyDates } from '../../../src/planner/helpers/weather-exposure';
import type { ParsedForecast } from '@tripick/utils';

describe('placeExposure', () => {
  it('음식점·카페는 분류만으로 지붕 아래가 확정된다', () => {
    expect(placeExposure({ name: '기장 해산물 식당', category: 'restaurant' })).toBe('indoor');
    expect(placeExposure({ name: '광안리 카페', category: 'cafe' })).toBe('indoor');
  });

  it('이름과 카테고리 상세 어느 쪽에 걸려도 실내로 본다 (소스마다 담는 자리가 다르다)', () => {
    // KTO 는 유형명('문화시설'), 카카오는 경로('문화,예술 > 문화시설 > 박물관')를 준다.
    expect(placeExposure({ name: '국립경주박물관', category: 'attraction' })).toBe('indoor');
    expect(
      placeExposure({ name: '어떤 곳', category: 'attraction', categoryDetail: '문화시설' }),
    ).toBe('indoor');
  });

  it('확실한 야외만 야외로 본다', () => {
    expect(placeExposure({ name: '해운대해수욕장', category: 'attraction' })).toBe('outdoor');
    expect(placeExposure({ name: '용소폭포', category: 'attraction' })).toBe('outdoor');
    expect(placeExposure({ name: '태화강국가정원', category: 'attraction', categoryDetail: '공원' })).toBe(
      'outdoor',
    );
  });

  it('실내·야외가 둘 다 걸리면 건물 쪽이 이긴다', () => {
    expect(placeExposure({ name: '해운대 아쿠아리움', category: 'attraction' })).toBe('indoor');
  });

  /**
   * 애매한 걸 넣으면 확실한 신호가 아니라 잡음이 된다 — 남산서울타워는 실내 전망대고,
   * 전통시장은 아케이드가 덮인 곳이 많다.
   */
  it.each([
    ['남산서울타워 전망대'],
    ['경주 중앙시장'],
    ['광명동굴'],
    ['불국사'],
  ])('%s 은 판정하지 않는다 (unknown)', (name) => {
    expect(placeExposure({ name, category: 'attraction' })).toBe('unknown');
  });

  it('카탈로그 대다수인 밋밋한 관광지는 unknown 으로 남는다', () => {
    expect(
      placeExposure({ name: '어느 관광지', category: 'attraction', categoryDetail: '관광지' }),
    ).toBe('unknown');
  });
});

describe('rainyDates', () => {
  it('강수형태가 잡히거나 강수확률 60% 이상이면 비 오는 날', () => {
    const forecasts = map([
      slot('20260710', '1500', { precipitationType: 1 }),
      slot('20260711', '1500', { precipitationProbability: 60 }),
      slot('20260712', '1500', { precipitationProbability: 50 }),
    ]);

    const rainy = rainyDates(forecasts, ['20260710', '20260711', '20260712'], '09:00', '22:00');

    expect([...rainy].sort()).toEqual(['20260710', '20260711']);
  });

  /** 자는 동안 오는 비 때문에 하루를 실내로 짜면 안 된다. */
  it('활동 구간 밖(새벽)의 비는 세지 않는다', () => {
    const forecasts = map([slot('20260710', '0300', { precipitationType: 1 })]);

    expect(rainyDates(forecasts, ['20260710'], '09:00', '22:00').size).toBe(0);
  });

  it('자정을 넘는 활동 구간이면 그 시간대의 비도 센다', () => {
    const forecasts = map([slot('20260710', '0000', { precipitationType: 1 })]);

    // 기상 08:00 · 취침 01:00 — 00:00 은 아직 활동 중이다.
    expect(rainyDates(forecasts, ['20260710'], '08:00', '01:00').has('20260710')).toBe(true);
  });

  it('대상 일차 밖의 날짜는 보지 않는다 (부분 재계획)', () => {
    const forecasts = map([
      slot('20260710', '1500', { precipitationType: 1 }),
      slot('20260711', '1500', { precipitationType: 1 }),
    ]);

    expect([...rainyDates(forecasts, ['20260711'], '09:00', '22:00')]).toEqual(['20260711']);
  });
});

function slot(date: string, time: string, extra: Partial<ParsedForecast>): ParsedForecast {
  return { date, time, ...extra };
}

function map(forecasts: ParsedForecast[]): Map<string, ParsedForecast> {
  return new Map(forecasts.map((forecast) => [`${forecast.date}_${forecast.time}`, forecast]));
}
