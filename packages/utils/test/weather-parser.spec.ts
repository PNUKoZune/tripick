/// <reference types="jest" />

import {
  parsePrecipitation,
  groupForecastItems,
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

  it('maps "1.0mm 미만"(소수 표기)도 0.5 로', () => {
    expect(parsePrecipitation('1.0mm 미만')).toBe(0.5);
  });

  it('범위 표기 "30.0~50.0mm" 는 하한값으로 파싱', () => {
    expect(parsePrecipitation('30.0~50.0mm')).toBe(30);
  });

  it('"50.0mm 이상" 은 하한값 50 으로 파싱', () => {
    expect(parsePrecipitation('50.0mm 이상')).toBe(50);
  });

  it('returns null for unrecognised strings', () => {
    expect(parsePrecipitation('알수없음')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parsePrecipitation('')).toBeNull();
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
