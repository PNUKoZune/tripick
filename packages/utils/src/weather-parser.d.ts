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
 * @returns mm 값, "강수없음" → null, "1mm 미만" → 0.5 (추정값)
 */
export declare function parsePrecipitation(value: string): number | null;
/**
 * 기상청 단기예보 아이템 배열 → 시간대별 ParsedForecast 맵으로 변환
 */
export declare function groupForecastItems(items: WeatherItem[]): Map<string, ParsedForecast>;
/**
 * 기상청 base_time 계산
 * 발표 후 10분 이후의 가장 가까운 base_time 반환
 *
 * @param now 현재 시각 (기본값: new Date())
 * @returns "0200" | "0500" | "0800" | "1100" | "1400" | "1700" | "2000" | "2300"
 */
export declare function getBaseTime(now?: Date): string;
//# sourceMappingURL=weather-parser.d.ts.map