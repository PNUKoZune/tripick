import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Redis } from 'ioredis';
import { latLngToGrid, getBaseTime, groupForecastItems, toKmaDate } from '@tripick/utils';
import type { ParsedForecast } from '@tripick/utils';

@Injectable()
export class WeatherHelper implements OnModuleDestroy {
  private readonly logger = new Logger(WeatherHelper.name);
  private readonly BASE_URL =
    'http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst';
  // 단기예보 발표 주기(3시간) 동안 같은 값이 유지되므로 그만큼 캐싱한다.
  private readonly CACHE_TTL_SEC = 3 * 60 * 60;
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

  async getForecast(
    lat: number,
    lng: number,
    date: Date = new Date(),
  ): Promise<Map<string, ParsedForecast>> {
    const apiKey = this.config.get<string>('KMA_API_KEY', '');
    if (!apiKey) {
      return new Map();
    }

    const { nx, ny } = latLngToGrid({ lat, lng });
    const baseDate = toKmaDate(date);
    const baseTime = getBaseTime(date);
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
  private async writeCache(key: string, forecasts: Map<string, ParsedForecast>): Promise<void> {
    if (forecasts.size === 0) return;
    try {
      await this.redis.set(key, JSON.stringify([...forecasts]), 'EX', this.CACHE_TTL_SEC);
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
