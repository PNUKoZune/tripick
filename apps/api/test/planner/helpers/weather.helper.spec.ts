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

  describe('getMidForecast', () => {
    it('returns an empty map and skips the API call when KMA key is unset', async () => {
      helper = new WeatherHelper(config());
      const result = await helper.getMidForecast(37.5665, 126.978);

      expect(result.size).toBe(0);
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('merges 중기육상예보 + 중기기온 into per-day forecasts', async () => {
      helper = new WeatherHelper(config({ KMA_API_KEY: 'test-key' }));
      const now = new Date('2026-07-14T10:00:00+09:00'); // tmFc 202607140600 → day3 = 2026-07-17

      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('getMidLandFcst')) {
          return Promise.resolve({
            data: { response: { body: { items: { item: [{ wf3Am: '맑음', rnSt3Am: 20, wf3Pm: '흐리고 비', rnSt3Pm: 80 }] } } } },
          });
        }
        return Promise.resolve({
          data: { response: { body: { items: { item: [{ taMin3: 21, taMax3: 29 }] } } } },
        });
      });

      const result = await helper.getMidForecast(37.5665, 126.978, now);

      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
      const pm = result.get('20260717_1500')!;
      expect(pm.temperature).toBe(29);
      expect(pm.precipitationProbability).toBe(80);
      expect(pm.precipitationType).toBe(1);
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

    it('scopes rainy slots to the given dates', () => {
      const map = new Map([
        ['20260710_1500', forecast({ date: '20260710', precipitationProbability: 80 })],
        ['20260712_1500', forecast({ date: '20260712', precipitationProbability: 90 })],
      ]);

      const hint = helper.buildWeatherHint(map, ['20260712']);

      // 다시 짜지 않는 일차(7/10)의 비까지 실리면 LLM 이 그 날을 피해 실내 장소를 당긴다.
      expect(hint).toContain('20260712_1500');
      expect(hint).not.toContain('20260710_1500');
    });

    it('falls back to fair weather when no slot falls in the given dates', () => {
      const map = new Map([
        ['20260710_1500', forecast({ date: '20260710', precipitationProbability: 80 })],
      ]);
      expect(helper.buildWeatherHint(map, ['20260712'])).toContain('날씨 양호');
    });

    it('keeps every slot when no dates are given', () => {
      const map = new Map([
        ['20260710_1500', forecast({ date: '20260710', precipitationProbability: 80 })],
        ['20260712_1500', forecast({ date: '20260712', precipitationProbability: 90 })],
      ]);

      const hint = helper.buildWeatherHint(map);

      expect(hint).toContain('20260710_1500');
      expect(hint).toContain('20260712_1500');
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
