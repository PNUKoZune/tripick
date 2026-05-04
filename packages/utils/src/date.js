"use strict";
/**
 * 날짜·시간 관련 공통 유틸
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.toKmaDate = toKmaDate;
exports.timeToMinutes = timeToMinutes;
exports.minutesToTime = minutesToTime;
exports.daysBetween = daysBetween;
/**
 * Date → 기상청 API 날짜 포맷 (YYYYMMDD)
 */
function toKmaDate(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
}
/**
 * "HH:mm" 시간 문자열 → 분 단위 정수
 * @example timeToMinutes("08:30") → 510
 */
function timeToMinutes(time) {
    const [h, m] = time.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
}
/**
 * 분 단위 정수 → "HH:mm" 시간 문자열
 * @example minutesToTime(510) → "08:30"
 */
function minutesToTime(minutes) {
    const h = Math.floor(minutes / 60) % 24;
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
/**
 * 두 날짜 간 일수 차이 계산 (절대값)
 */
function daysBetween(a, b) {
    const MS_PER_DAY = 1000 * 60 * 60 * 24;
    return Math.round(Math.abs(a.getTime() - b.getTime()) / MS_PER_DAY);
}
//# sourceMappingURL=date.js.map