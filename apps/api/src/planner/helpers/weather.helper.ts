import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { latLngToGrid, getBaseTime, groupForecastItems, toKmaDate } from '@tripick/utils';
import type { ParsedForecast } from '@tripick/utils';

/**
 * 기상청 단기예보 API 조회 Helper
 *
 * base_time: 02·05·08·11·14·17·20·23시 발표
 * PCP 필드: "강수없음", "1mm 미만" 등 문자열 파싱 필요 → weather-parser 사용
 */
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
    const { nx, ny } = latLngToGrid({ lat, lng });
    const baseDate = toKmaDate(date);
    const baseTime = getBaseTime(date);
    const apiKey = this.config.get<string>('KMA_API_KEY', '');

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

  /**
   * 날씨 예보를 바탕으로 일정 조정 힌트 텍스트 생성
   * (비·눈 예보 시 실내 장소 우선 배치 권고)
   */
  buildWeatherHint(forecasts: Map<string, ParsedForecast>): string {
    const rainySlots: string[] = [];

    for (const [key, f] of forecasts) {
      if (
        (f.precipitationProbability ?? 0) >= 60 ||
        (f.precipitationType !== undefined && f.precipitationType > 0)
      ) {
        rainySlots.push(key);
      }
    }

    if (rainySlots.length === 0) return '날씨 양호, 실외 일정 가능.';
    return `다음 시간대에 강수 예보: ${rainySlots.slice(0, 5).join(', ')}. 해당 시간대 실내 장소(카페·박물관·쇼핑몰) 우선 배치 권장.`;
  }
}
