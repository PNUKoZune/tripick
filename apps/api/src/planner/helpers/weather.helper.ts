import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { latLngToGrid, getBaseTime, groupForecastItems, toKmaDate } from '@tripick/utils';
import type { ParsedForecast } from '@tripick/utils';

@Injectable()
export class WeatherHelper {
  private readonly logger = new Logger(WeatherHelper.name);
  private readonly BASE_URL =
    'http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst';

  constructor(private readonly config: ConfigService) {}

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
      return groupForecastItems(items);
    } catch (err) {
      this.logger.error(`기상청 API 조회 실패 (nx=${nx}, ny=${ny}):`, err);
      return new Map();
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
