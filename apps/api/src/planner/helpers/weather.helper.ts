import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Redis } from 'ioredis';
import {
  latLngToGrid,
  getBaseDateTime,
  groupForecastItems,
  latLngToMidRegion,
  parseMidTermForecast,
  getMidTmFc,
  tmFcToDate,
} from '@tripick/utils';
import type { ParsedForecast, MidLandItem, MidTaItem } from '@tripick/utils';

@Injectable()
export class WeatherHelper implements OnModuleDestroy {
  private readonly logger = new Logger(WeatherHelper.name);
  private readonly BASE_URL =
    'http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst';
  private readonly MID_LAND_URL =
    'http://apis.data.go.kr/1360000/MidFcstInfoService/getMidLandFcst';
  private readonly MID_TA_URL =
    'http://apis.data.go.kr/1360000/MidFcstInfoService/getMidTa';
  // 단기예보 발표 주기(3시간) 동안 같은 값이 유지되므로 그만큼 캐싱한다.
  private readonly CACHE_TTL_SEC = 3 * 60 * 60;
  // 중기예보는 매일 06·18시 2회 발표되므로 그 주기만큼 캐싱한다.
  private readonly MID_CACHE_TTL_SEC = 12 * 60 * 60;
  // 육상·기온 중 한쪽만 성공한 부분 결과는 곧 재조회하도록 짧게만 캐싱한다.
  private readonly MID_PARTIAL_TTL_SEC = 30 * 60;
  private readonly redis: Redis;

  constructor(private readonly config: ConfigService) {
    this.redis = new Redis({
      host: this.config.get<string>('REDIS_HOST', 'localhost'),
      port: this.config.get<number>('REDIS_PORT', 6379),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    // Redis 미가동 시에도 예보 조회 자체는 실패하면 안 되므로 에러를 삼킨다.
    this.redis.on('error', () => undefined);
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }

  /**
   * 기상청 단기예보 조회.
   * @param now 발표시각 산정 기준(기본 현재). 예보 대상일이 아니라 "언제 발표된 것을
   *            조회할지" 기준이므로 항상 현재여야 한다. 대상일 필터는 소비 측에서 fcstDate 로 한다.
   */
  async getForecast(
    lat: number,
    lng: number,
    now: Date = new Date(),
  ): Promise<Map<string, ParsedForecast>> {
    const apiKey = this.config.get<string>('KMA_API_KEY', '');
    if (!apiKey) {
      return new Map();
    }

    const { nx, ny } = latLngToGrid({ lat, lng });
    const { baseDate, baseTime } = getBaseDateTime(now);
    const cacheKey = `weather:forecast:${nx}:${ny}:${baseDate}:${baseTime}`;

    const cached = await this.readCache(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const res = await axios.get<{
        response: {
          body: {
            items: {
              item: Array<{
                baseDate: string;
                baseTime: string;
                category: string;
                fcstDate: string;
                fcstTime: string;
                fcstValue: string;
                nx: number;
                ny: number;
              }>;
            };
          };
        };
      }>(this.BASE_URL, {
        params: {
          serviceKey: apiKey,
          pageNo: 1,
          numOfRows: 1000,
          dataType: 'JSON',
          base_date: baseDate,
          base_time: baseTime,
          nx,
          ny,
        },
      });

      const items = res.data.response.body.items.item;
      const forecasts = groupForecastItems(items);
      await this.writeCache(cacheKey, forecasts);
      return forecasts;
    } catch (err) {
      this.logger.error(`기상청 API 조회 실패 (nx=${nx}, ny=${ny}):`, err);
      return new Map();
    }
  }

  /**
   * 기상청 중기예보(육상예보 + 기온)를 조회해 +3~+10일 일자별 예보맵으로 반환한다.
   * - 육상예보(getMidLandFcst)·기온(getMidTa)을 각각 조회해 하나로 합성한다.
   * - regId 는 좌표를 가장 가까운 예보구역으로 스냅해 결정한다.
   * - KMA_API_KEY 미설정·조회 실패 시 빈 맵을 반환한다(단기예보만으로 폴백).
   */
  async getMidForecast(
    lat: number,
    lng: number,
    now: Date = new Date(),
  ): Promise<Map<string, ParsedForecast>> {
    const apiKey = this.config.get<string>('KMA_API_KEY', '');
    if (!apiKey) {
      return new Map();
    }

    const region = latLngToMidRegion({ lat, lng });
    const tmFc = getMidTmFc(now);
    const cacheKey = `weather:mid:${region.landRegId}:${region.taRegId}:${tmFc}`;

    const cached = await this.readCache(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const [land, ta] = await Promise.all([
        this.fetchMidItem<MidLandItem>(this.MID_LAND_URL, apiKey, region.landRegId, tmFc),
        this.fetchMidItem<MidTaItem>(this.MID_TA_URL, apiKey, region.taRegId, tmFc),
      ]);

      // 육상·기온 둘 다 비었으면 캐시하지 않고 빈 맵 반환
      if (!land && !ta) {
        return new Map();
      }

      const forecasts = parseMidTermForecast(land, ta, tmFcToDate(tmFc));
      // 한쪽만 성공한 부분 결과는 짧게만 캐시해, 일시 오류가 반나절 고착되지 않게 한다.
      const ttl = land && ta ? this.MID_CACHE_TTL_SEC : this.MID_PARTIAL_TTL_SEC;
      await this.writeCache(cacheKey, forecasts, ttl);
      return forecasts;
    } catch (err) {
      this.logger.error(`기상청 중기예보 조회 실패 (${region.name}, tmFc=${tmFc}):`, err);
      return new Map();
    }
  }

  /** 중기예보 단일 오퍼레이션을 조회해 첫 item 을 반환한다. 실패/빈 응답 시 undefined. */
  private async fetchMidItem<T>(
    url: string,
    apiKey: string,
    regId: string,
    tmFc: string,
  ): Promise<T | undefined> {
    try {
      const res = await axios.get<{
        response: { body?: { items?: { item?: T[] } } };
      }>(url, {
        params: {
          serviceKey: apiKey,
          pageNo: 1,
          numOfRows: 10,
          dataType: 'JSON',
          regId,
          tmFc,
        },
      });
      return res.data.response?.body?.items?.item?.[0];
    } catch (err) {
      this.logger.warn(`중기예보 오퍼레이션 조회 실패 (${url}, regId=${regId}):`, err);
      return undefined;
    }
  }

  /**
   * 단기예보(~3일)와 중기예보(+3~+10일)를 병합한 확장 예보맵을 반환한다.
   * - 단기예보가 존재하는 날짜는 더 정밀하므로 우선하고, 중기예보 슬롯은 배제한다.
   * - 나머지 날짜는 중기예보로 채워 최대 10일까지 커버한다.
   *
   * 두 조회 모두 "지금 발표분" 기준이며, 대상일 필터는 소비 측에서 fcstDate 로 한다.
   * (여행 시작일 등 미래 날짜를 발표 기준으로 넘기면 NO_DATA 가 나므로 받지 않는다.)
   */
  async getExtendedForecast(
    lat: number,
    lng: number,
  ): Promise<Map<string, ParsedForecast>> {
    const [shortTerm, midTerm] = await Promise.all([
      this.getForecast(lat, lng),
      this.getMidForecast(lat, lng),
    ]);

    const shortDates = new Set([...shortTerm.values()].map((f) => f.date));
    const merged = new Map(shortTerm);
    for (const [key, forecast] of midTerm) {
      if (shortDates.has(forecast.date)) continue;
      merged.set(key, forecast);
    }
    return merged;
  }

  /** Redis 에 캐시된 예보맵을 복원한다. 미스/장애 시 null 을 반환해 실호출로 넘긴다. */
  private async readCache(key: string): Promise<Map<string, ParsedForecast> | null> {
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      const entries = JSON.parse(raw) as Array<[string, ParsedForecast]>;
      return new Map(entries);
    } catch {
      return null;
    }
  }

  /** 예보맵을 TTL 과 함께 Redis 에 저장한다. 장애 시 조용히 무시한다. */
  private async writeCache(
    key: string,
    forecasts: Map<string, ParsedForecast>,
    ttlSec: number = this.CACHE_TTL_SEC,
  ): Promise<void> {
    if (forecasts.size === 0) return;
    try {
      await this.redis.set(key, JSON.stringify([...forecasts]), 'EX', ttlSec);
    } catch {
      // 캐시 실패는 예보 조회 성공을 막지 않는다.
    }
  }

  buildWeatherHint(forecasts: Map<string, ParsedForecast>): string {
    const rainySlots: string[] = [];

    for (const [key, forecast] of forecasts) {
      if (
        (forecast.precipitationProbability ?? 0) >= 60 ||
        (forecast.precipitationType !== undefined && forecast.precipitationType > 0)
      ) {
        rainySlots.push(key);
      }
    }

    if (rainySlots.length === 0) return '날씨 양호, 실외 일정 가능.';
    return `다음 시간대에 강수 예보: ${rainySlots.slice(0, 5).join(', ')}. 해당 시간대 실내 장소 우선 배치 권장.`;
  }
}
