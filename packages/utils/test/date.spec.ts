/// <reference types="jest" />

import { toKmaDate, timeToMinutes, minutesToTime, daysBetween } from '../src/date';

describe('toKmaDate', () => {
  it('formats a date as YYYYMMDD with zero padding', () => {
    expect(toKmaDate(new Date(2026, 6, 3))).toBe('20260703'); // 7월 3일
  });
});

describe('timeToMinutes / minutesToTime', () => {
  it('converts "HH:mm" to minutes', () => {
    expect(timeToMinutes('08:30')).toBe(510);
    expect(timeToMinutes('00:00')).toBe(0);
    expect(timeToMinutes('23:59')).toBe(1439);
  });

  it('converts minutes back to "HH:mm"', () => {
    expect(minutesToTime(510)).toBe('08:30');
    expect(minutesToTime(0)).toBe('00:00');
  });

  it('wraps hours past midnight with modulo 24', () => {
    expect(minutesToTime(24 * 60 + 30)).toBe('00:30');
  });

  it('round-trips a range of times', () => {
    for (const t of ['06:15', '12:00', '19:45']) {
      expect(minutesToTime(timeToMinutes(t))).toBe(t);
    }
  });
});

describe('daysBetween', () => {
  it('returns the absolute day difference regardless of order', () => {
    const a = new Date(2026, 6, 3);
    const b = new Date(2026, 6, 7);
    expect(daysBetween(a, b)).toBe(4);
    expect(daysBetween(b, a)).toBe(4);
  });

  it('returns 0 for the same day', () => {
    const a = new Date(2026, 6, 3, 9, 0);
    const b = new Date(2026, 6, 3, 20, 0);
    expect(daysBetween(a, b)).toBe(0);
  });
});
