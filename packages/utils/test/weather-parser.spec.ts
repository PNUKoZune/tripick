/// <reference types="jest" />

import {
  parsePrecipitation,
  groupForecastItems,
  getBaseTime,
  type WeatherItem,
} from '../src/weather-parser';

describe('parsePrecipitation', () => {
  it('maps "강수없음" to null', () => {
    expect(parsePrecipitation('강수없음')).toBeNull();
  });

  it('maps "1mm 미만" to the 0.5 estimate', () => {
    expect(parsePrecipitation('1mm 미만')).toBe(0.5);
  });

  it('parses numeric mm strings', () => {
    expect(parsePrecipitation('3.5mm')).toBe(3.5);
    expect(parsePrecipitation('12.0mm')).toBe(12);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parsePrecipitation('  강수없음 ')).toBeNull();
  });

  it('returns null for unrecognised strings', () => {
    expect(parsePrecipitation('알수없음')).toBeNull();
  });
});

describe('groupForecastItems', () => {
  const item = (over: Partial<WeatherItem>): WeatherItem => ({
    baseDate: '20260703',
    baseTime: '0500',
    category: 'TMP',
    fcstDate: '20260703',
    fcstTime: '1200',
    fcstValue: '0',
    nx: 60,
    ny: 127,
    ...over,
  });

  it('merges categories sharing the same fcstDate_fcstTime into one forecast', () => {
    const map = groupForecastItems([
      item({ category: 'TMP', fcstValue: '27' }),
      item({ category: 'POP', fcstValue: '60' }),
      item({ category: 'PTY', fcstValue: '1' }),
      item({ category: 'SKY', fcstValue: '4' }),
      item({ category: 'PCP', fcstValue: '1mm 미만' }),
      item({ category: 'REH', fcstValue: '80' }),
      item({ category: 'WSD', fcstValue: '3.2' }),
    ]);

    expect(map.size).toBe(1);
    const forecast = map.get('20260703_1200')!;
    expect(forecast.temperature).toBe(27);
    expect(forecast.precipitationProbability).toBe(60);
    expect(forecast.precipitationType).toBe(1);
    expect(forecast.skyCondition).toBe(4);
    expect(forecast.precipitation).toBe(0.5);
    expect(forecast.humidity).toBe(80);
    expect(forecast.windSpeed).toBe(3.2);
  });

  it('keys distinct time slots separately', () => {
    const map = groupForecastItems([
      item({ fcstTime: '1200', category: 'TMP', fcstValue: '27' }),
      item({ fcstTime: '1500', category: 'TMP', fcstValue: '29' }),
    ]);
    expect(map.size).toBe(2);
    expect(map.get('20260703_1500')!.temperature).toBe(29);
  });
});

describe('getBaseTime', () => {
  it('picks the previous slot when the 10-minute delay has not elapsed', () => {
    // 05:05 → 발표(0500) 후 10분이 안 지났으니 이전 슬롯 0200
    expect(getBaseTime(new Date(2026, 6, 3, 5, 5))).toBe('0200');
  });

  it('picks the current slot once the delay has elapsed', () => {
    // 05:15 → 0500 발표가 확정됨
    expect(getBaseTime(new Date(2026, 6, 3, 5, 15))).toBe('0500');
  });

  it('falls back to the first slot in the early morning', () => {
    expect(getBaseTime(new Date(2026, 6, 3, 1, 0))).toBe('0200');
  });

  it('returns the last slot late at night', () => {
    expect(getBaseTime(new Date(2026, 6, 3, 23, 30))).toBe('2300');
  });
});
