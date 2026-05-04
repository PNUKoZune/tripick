/**
 * 날짜·시간 관련 공통 유틸
 */
/**
 * Date → 기상청 API 날짜 포맷 (YYYYMMDD)
 */
export declare function toKmaDate(date?: Date): string;
/**
 * "HH:mm" 시간 문자열 → 분 단위 정수
 * @example timeToMinutes("08:30") → 510
 */
export declare function timeToMinutes(time: string): number;
/**
 * 분 단위 정수 → "HH:mm" 시간 문자열
 * @example minutesToTime(510) → "08:30"
 */
export declare function minutesToTime(minutes: number): string;
/**
 * 두 날짜 간 일수 차이 계산 (절대값)
 */
export declare function daysBetween(a: Date, b: Date): number;
//# sourceMappingURL=date.d.ts.map