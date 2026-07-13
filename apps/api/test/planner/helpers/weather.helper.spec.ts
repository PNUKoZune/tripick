/// <reference types="jest" />

import axios from 'axios';
import { WeatherHelper } from '../../../src/planner/helpers/weather.helper';
import type { ParsedForecast } from '@tripick/utils';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function config(overrides: Record<string, string> = {}) {
  return {
    get: <T>(key: string, def?: T) => (key in overrides ? (overrides[key] as unknown as T) : def),
  } as any;
}

function forecast(over: Partial<ParsedForecast>): ParsedForecast {
  return { date: '20260710', time: '1200', ...over };
}

describe('WeatherHelper', () => {
  let helper: WeatherHelper;

  afterEach(() => {
    // lazyConnect Redis 핸들 정리 (실제 연결은 열리지 않는다).
    helper?.onModuleDestroy();
    jest.clearAllMocks();
  });

  describe('getForecast', () => {
    it('returns an empty map and skips the API call when KMA key is unset', async () => {
      helper = new WeatherHelper(config());
      const result = await helper.getForecast(37.5665, 126.978);

      expect(result.size).toBe(0);
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });
  });

  describe('buildWeatherHint', () => {
    beforeEach(() => {
      helper = new WeatherHelper(config());
    });

    it('reports fair weather when no slot is rainy', () => {
      const map = new Map([
        ['20260710_1200', forecast({ precipitationProbability: 20, precipitationType: 0 })],
      ]);
      expect(helper.buildWeatherHint(map)).toContain('날씨 양호');
    });

    it('flags slots with high precipitation probability', () => {
      const map = new Map([
        ['20260710_1500', forecast({ precipitationProbability: 70, precipitationType: 0 })],
      ]);
      const hint = helper.buildWeatherHint(map);
      expect(hint).toContain('강수 예보');
      expect(hint).toContain('20260710_1500');
    });

    it('flags slots with an active precipitation type even at low probability', () => {
      const map = new Map([
        ['20260710_0900', forecast({ precipitationProbability: 10, precipitationType: 1 })],
      ]);
      expect(helper.buildWeatherHint(map)).toContain('강수 예보');
    });

    it('caps the listed rainy slots at five', () => {
      const map = new Map(
        Array.from({ length: 8 }, (_, i) => [
          `20260710_${String(i).padStart(2, '0')}00`,
          forecast({ precipitationProbability: 80 }),
        ]),
      );
      const hint = helper.buildWeatherHint(map);
      expect(hint.match(/20260710_/g)).toHaveLength(5);
    });
  });
});
