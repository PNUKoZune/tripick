/**
 * 기상청 단기예보 응답 파싱 유틸
 *
 * 주의사항:
 * - PCP(강수량) 필드는 "강수없음", "1mm 미만" 등 문자열로 올 수 있어 예외처리 필수
 * - base_time: 02·05·08·11·14·17·20·23시 발표, 발표 후 10분 지연 여유 필요
 */

export interface WeatherItem {
  baseDate: string;
  baseTime: string;
  category: string;
  fcstDate: string;
  fcstTime: string;
  fcstValue: string;
  nx: number;
  ny: number;
}

export interface ParsedForecast {
  date: string;
  time: string;
  /** 기온 (°C) */
  temperature?: number;
  /** 최저기온 (°C) */
  minTemperature?: number;
  /** 최고기온 (°C) */
  maxTemperature?: number;
  /** 강수확률 (%) */
  precipitationProbability?: number;
  /** 강수량 (mm), null이면 "강수없음" */
  precipitation?: number | null;
  /** 강수형태: 0=없음, 1=비, 2=비/눈, 3=눈, 5=빗방울, 6=빗방울눈날림, 7=눈날림 */
  precipitationType?: number;
  /** 하늘상태: 1=맑음, 3=구름많음, 4=흐림 */
  skyCondition?: number;
  /** 습도 (%) */
  humidity?: number;
  /** 풍속 (m/s) */
  windSpeed?: number;
}

/**
 * 강수량 문자열 파싱 (기상청 특수 문자열 처리)
 *
 * 기상청 PCP/SNO 는 "강수없음", "1.0mm 미만", "30.0~50.0mm", "50.0mm 이상" 등
 * 다양한 표기로 온다.
 *
 * @returns mm 값. "강수없음" → null, "~mm 미만" → 0.5(추정),
 *          범위("a~b mm") → 하한값 a, "b mm 이상" → b, 그 외 첫 숫자값.
 */
export function parsePrecipitation(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === '강수없음') return null;
  // "1mm 미만" / "1.0mm 미만" 등 미만 구간은 0.5mm 로 추정
  if (trimmed.includes('미만')) return 0.5;

  // "30.0~50.0mm"(범위)·"50.0mm 이상"·"1.2mm" → 첫 숫자값(범위는 하한)
  const match = /([\d.]+)/.exec(trimmed);
  if (match?.[1]) {
    const n = parseFloat(match[1]);
    return Number.isFinite(n) ? n : null;
  }

  return null;
}

/**
 * 기상청 단기예보 아이템 배열 → 시간대별 ParsedForecast 맵으로 변환
 */
export function groupForecastItems(
  items: WeatherItem[],
): Map<string, ParsedForecast> {
  const map = new Map<string, ParsedForecast>();

  for (const item of items) {
    const key = `${item.fcstDate}_${item.fcstTime}`;
    if (!map.has(key)) {
      map.set(key, { date: item.fcstDate, time: item.fcstTime });
    }
    const forecast = map.get(key)!;

    switch (item.category) {
      case 'TMP':
        forecast.temperature = parseFloat(item.fcstValue);
        break;
      case 'TMN':
        forecast.minTemperature = parseFloat(item.fcstValue);
        break;
      case 'TMX':
        forecast.maxTemperature = parseFloat(item.fcstValue);
        break;
      case 'POP':
        forecast.precipitationProbability = parseInt(item.fcstValue, 10);
        break;
      case 'PCP':
        forecast.precipitation = parsePrecipitation(item.fcstValue);
        break;
      case 'PTY':
        forecast.precipitationType = parseInt(item.fcstValue, 10);
        break;
      case 'SKY':
        forecast.skyCondition = parseInt(item.fcstValue, 10);
        break;
      case 'REH':
        forecast.humidity = parseInt(item.fcstValue, 10);
        break;
      case 'WSD':
        forecast.windSpeed = parseFloat(item.fcstValue);
        break;
    }
  }

  return map;
}
