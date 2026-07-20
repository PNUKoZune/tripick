/**
 * 날짜·시간 관련 공통 유틸
 */

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Asia/Seoul(KST) 기준 날짜·시각 구성요소 */
export interface KstParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/**
 * 임의의 Date 를 Asia/Seoul 기준 날짜·시각 구성요소로 변환한다.
 * 서버 타임존(UTC 등)과 무관하게 기상청 API가 기대하는 KST 기준으로 계산하기 위함.
 */
export function getKstParts(date: Date = new Date()): KstParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  // 일부 엔진은 자정을 '24'로 표기하므로 0 으로 보정
  const hour = get('hour') % 24;
  return { year: get('year'), month: get('month'), day: get('day'), hour, minute: get('minute') };
}

/**
 * Date → 기상청 API 날짜 포맷 (YYYYMMDD), Asia/Seoul 기준
 */
export function toKmaDate(date: Date = new Date()): string {
  const { year, month, day } = getKstParts(date);
  return `${year}${pad2(month)}${pad2(day)}`;
}

/**
 * Date → Asia/Seoul 기준 "YYYY-MM-DD" 문자열.
 * 서버 로컬 TZ 의 getFullYear/getMonth/getDate 를 쓰면 UTC 컨테이너에서 하루가 밀리므로
 * 항상 KST 구성요소로 조립한다. ("오늘"(KST) 판정·일자 비교의 정본)
 */
export function toKstIsoDate(date: Date = new Date()): string {
  const { year, month, day } = getKstParts(date);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * "YYYY-MM-DD" 에 일수를 더한다 (UTC 정수 연산이라 서버 TZ·서머타임에 영향받지 않는다).
 * @example addDaysToIsoDate("2026-07-20", 1) → "2026-07-21"
 */
export function addDaysToIsoDate(iso: string, days: number): string {
  const [y = 0, m = 1, d = 1] = iso.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + days);
  return `${utc.getUTCFullYear()}-${pad2(utc.getUTCMonth() + 1)}-${pad2(utc.getUTCDate())}`;
}

/**
 * "HH:mm" 시간 문자열 → 분 단위 정수
 * @example timeToMinutes("08:30") → 510
 */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * 분 단위 정수 → "HH:mm" 시간 문자열
 * @example minutesToTime(510) → "08:30"
 */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * 두 날짜 간 일수 차이 계산 (절대값)
 */
export function daysBetween(a: Date, b: Date): number {
  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  return Math.round(Math.abs(a.getTime() - b.getTime()) / MS_PER_DAY);
}

/** YYYYMMDD 정수 구성요소 → "YYYYMMDD" */
function ymd(year: number, month: number, day: number): string {
  return `${year}${pad2(month)}${pad2(day)}`;
}

/**
 * 기상청 단기예보 발표일·발표시각(base_date·base_time) 계산 (Asia/Seoul 기준).
 *
 * 발표 시각은 02·05·08·11·14·17·20·23시이며 발표 후 10분의 반영 지연을 둔다.
 * 당일 02시 발표 전(00:00~02:10)에는 전날 23시 발표분을 조회해야 하므로
 * 날짜를 하루 되돌린다. (base_time 만 계산하면 미래 시각을 조회해 NO_DATA 가 남)
 *
 * @returns { baseDate: "YYYYMMDD", baseTime: "0200" | ... | "2300" }
 */
export function getBaseDateTime(now: Date = new Date()): {
  baseDate: string;
  baseTime: string;
} {
  const BASE_TIMES = [2, 5, 8, 11, 14, 17, 20, 23];
  const DELAY_MINUTES = 10;

  const { year, month, day, hour, minute } = getKstParts(now);
  const totalMinutes = hour * 60 + minute - DELAY_MINUTES;

  let idx = -1;
  for (let i = BASE_TIMES.length - 1; i >= 0; i--) {
    if (totalMinutes >= (BASE_TIMES[i] ?? 0) * 60) {
      idx = i;
      break;
    }
  }

  if (idx === -1) {
    // 당일 첫 발표(02시) 전 → 전날 2300 발표분
    const prev = new Date(Date.UTC(year, month - 1, day));
    prev.setUTCDate(prev.getUTCDate() - 1);
    return {
      baseDate: ymd(prev.getUTCFullYear(), prev.getUTCMonth() + 1, prev.getUTCDate()),
      baseTime: '2300',
    };
  }

  return { baseDate: ymd(year, month, day), baseTime: `${pad2(BASE_TIMES[idx]!)}00` };
}
