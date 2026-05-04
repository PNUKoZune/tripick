"use strict";
/**
 * 기상청 단기예보 응답 파싱 유틸
 *
 * 주의사항:
 * - PCP(강수량) 필드는 "강수없음", "1mm 미만" 등 문자열로 올 수 있어 예외처리 필수
 * - base_time: 02·05·08·11·14·17·20·23시 발표, 발표 후 10분 지연 여유 필요
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePrecipitation = parsePrecipitation;
exports.groupForecastItems = groupForecastItems;
exports.getBaseTime = getBaseTime;
/**
 * 강수량 문자열 파싱 (기상청 특수 문자열 처리)
 *
 * @returns mm 값, "강수없음" → null, "1mm 미만" → 0.5 (추정값)
 */
function parsePrecipitation(value) {
    const trimmed = value.trim();
    if (trimmed === '강수없음')
        return null;
    if (trimmed === '1mm 미만')
        return 0.5;
    const match = /^([\d.]+)mm?/.exec(trimmed);
    if (match?.[1])
        return parseFloat(match[1]);
    return null;
}
/**
 * 기상청 단기예보 아이템 배열 → 시간대별 ParsedForecast 맵으로 변환
 */
function groupForecastItems(items) {
    const map = new Map();
    for (const item of items) {
        const key = `${item.fcstDate}_${item.fcstTime}`;
        if (!map.has(key)) {
            map.set(key, { date: item.fcstDate, time: item.fcstTime });
        }
        const forecast = map.get(key);
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
/**
 * 기상청 base_time 계산
 * 발표 후 10분 이후의 가장 가까운 base_time 반환
 *
 * @param now 현재 시각 (기본값: new Date())
 * @returns "0200" | "0500" | "0800" | "1100" | "1400" | "1700" | "2000" | "2300"
 */
function getBaseTime(now = new Date()) {
    const BASE_TIMES = [2, 5, 8, 11, 14, 17, 20, 23];
    const DELAY_MINUTES = 10;
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const totalMinutes = hours * 60 + minutes - DELAY_MINUTES;
    let baseHour = BASE_TIMES[0];
    for (let i = BASE_TIMES.length - 1; i >= 0; i--) {
        if (totalMinutes >= (BASE_TIMES[i] ?? 0) * 60) {
            baseHour = BASE_TIMES[i];
            break;
        }
    }
    return String(baseHour).padStart(2, '0') + '00';
}
//# sourceMappingURL=weather-parser.js.map