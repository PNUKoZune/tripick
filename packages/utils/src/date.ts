/**
 * 날짜·시간 관련 공통 유틸
 */

/**
 * Date → 기상청 API 날짜 포맷 (YYYYMMDD)
 */
export function toKmaDate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
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
