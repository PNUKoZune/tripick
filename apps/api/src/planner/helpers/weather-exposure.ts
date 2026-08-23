import { getAwakeWindow, minutesSinceWake } from '@tripick/utils';
import type { ParsedForecast } from '@tripick/utils';

/**
 * 비에 얼마나 노출되는 장소인가.
 *
 * `unknown` 이 1급 값인 게 중요하다 — 카탈로그의 절대다수는 KTO '관광지'(전국 12,253행)라
 * 이름·분류만으로는 실내인지 야외인지 알 수 없다. 모르는 걸 야외로 가정하면 비 오는 날
 * 후보 대부분이 밀려나고, 실내로 가정하면 이 신호 자체가 무의미해진다. 판정 불가는 판정
 * 불가로 두고 확실한 것만 움직인다 — 지역 판정(§matchesRegionFilter)·인지도 감점과 같은 원칙.
 */
export type WeatherExposure = 'indoor' | 'outdoor' | 'unknown';

/** 확실히 지붕 아래인 장소. 이름 또는 카테고리 상세에 걸린다. */
const INDOOR_KEYWORDS = [
  '박물관',
  '미술관',
  '전시관',
  '기념관',
  '과학관',
  '문화원',
  '도서관',
  '아쿠아리움',
  '수족관',
  '영화관',
  '공연장',
  '극장',
  '문화시설',
  '실내',
  '온천',
  '스파',
  '찜질',
  '백화점',
  '아울렛',
  '쇼핑몰',
  '체험관',
] as const;

/**
 * 확실히 하늘 아래인 장소.
 *
 * '전망대'·'시장'·'동굴'은 **일부러 뺐다** — 남산서울타워는 실내 전망대고, 전통시장은 아케이드가
 * 덮인 곳이 많고, 동굴은 안은 지붕 아래지만 가는 길이 야외다. 애매한 걸 넣으면 확실한 신호가
 * 아니라 잡음이 된다.
 */
const OUTDOOR_KEYWORDS = [
  '해수욕장',
  '해변',
  '해안',
  '계곡',
  '폭포',
  '수목원',
  '휴양림',
  '유원지',
  '둘레길',
  '산책로',
  '올레길',
  '오름',
  '캠핑',
  '야영',
  '서핑',
  '등산',
  '트레킹',
  '공원',
  '저수지',
  '갯벌',
  '목장',
  '농원',
  '낚시',
  '포구',
] as const;

/**
 * 장소의 우천 노출도. 음식점·카페는 분류만으로 지붕 아래가 확정된다.
 *
 * 이름과 카테고리 상세를 함께 보는 이유 — KTO 는 '문화시설' 같은 유형명을 주고 카카오는
 * '문화,예술 > 문화시설 > 박물관' 경로를 준다. 둘 중 하나만 보면 한 소스의 신호를 통째로 놓친다.
 */
export function placeExposure(place: {
  name: string;
  category: string;
  categoryDetail?: string;
}): WeatherExposure {
  if (place.category === 'restaurant' || place.category === 'cafe') return 'indoor';

  const haystack = `${place.name} ${place.categoryDetail ?? ''}`;
  // 실내를 먼저 본다 — '해운대 아쿠아리움'처럼 둘 다 걸리는 이름은 건물 쪽이 정답이다.
  if (INDOOR_KEYWORDS.some((keyword) => haystack.includes(keyword))) return 'indoor';
  if (OUTDOOR_KEYWORDS.some((keyword) => haystack.includes(keyword))) return 'outdoor';
  return 'unknown';
}

/**
 * 강수 슬롯 판정. `WeatherHelper.buildWeatherHint`(LLM 힌트)·`WeatherAlertService`(알림)와
 * **같은 기준**이다. 갈리면 프롬프트는 비가 온다고 말하는데 결정적 배치는 아니라고 보는,
 * 경로마다 다른 일정이 나온다.
 */
function isRainy(forecast: ParsedForecast): boolean {
  if (forecast.precipitationType !== undefined && forecast.precipitationType > 0) return true;
  return (forecast.precipitationProbability ?? 0) >= 60;
}

/**
 * 활동 구간에 비가 걸리는 날짜(`YYYYMMDD`)를 고른다.
 *
 * **일자 단위**인 게 의도다. 슬롯별로 가르려면 그 슬롯이 몇 시인지 알아야 하는데, 배치 단계의
 * 시각은 "체류 120분 + 이동 30분" 누적 추정치라 실제와 한두 시간씩 어긋난다(§daySlotRoles).
 * 3시간 간격 예보를 그 추정치에 맞춰 잘라 봐야 정확도가 없는 정밀도만 생긴다.
 *
 * 활동 구간 밖(새벽)의 비는 세지 않는다 — 자는 동안 오는 비 때문에 하루를 실내로 짜면 안 된다.
 */
export function rainyDates(
  forecasts: Map<string, ParsedForecast>,
  dates: readonly string[],
  wakeTime: string,
  sleepTime: string,
): Set<string> {
  const scope = new Set(dates);
  const window = getAwakeWindow(wakeTime, sleepTime);
  const rainy = new Set<string>();

  for (const forecast of forecasts.values()) {
    if (!scope.has(forecast.date)) continue;
    if (!isRainy(forecast)) continue;
    const minutes = Number(forecast.time.slice(0, 2)) * 60 + Number(forecast.time.slice(2, 4));
    if (!Number.isFinite(minutes)) continue;
    if (minutesSinceWake(minutes, window.wakeMinutes) >= window.lengthMinutes) continue;
    rainy.add(forecast.date);
  }

  return rainy;
}
