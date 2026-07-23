/// <reference types="jest" />

import {
  toKmaDate,
  timeToMinutes,
  minutesToTime,
  daysBetween,
  countTripDays,
  getKstParts,
  getBaseDateTime,
} from '../src/date';

describe('countTripDays', () => {
  it('당일치기는 1', () => {
    expect(countTripDays('2026-07-10', '2026-07-10')).toBe(1);
  });

  it('1박 2일 = 2', () => {
    expect(countTripDays('2026-07-10', '2026-07-11')).toBe(2);
  });

  it('월 경계를 넘어도 포함 일수로 계산', () => {
    expect(countTripDays('2026-07-30', '2026-08-02')).toBe(4);
  });

  it('endIso < startIso 또는 파싱 실패면 1 로 클램프', () => {
    expect(countTripDays('2026-07-11', '2026-07-10')).toBe(1);
    expect(countTripDays('', '')).toBe(1);
  });
});

describe('toKmaDate', () => {
  it('formats a date as YYYYMMDD with zero padding', () => {
    // 정오 KST 인스턴트 → 서버 TZ 무관하게 20260703
    expect(toKmaDate(new Date('2026-07-03T12:00:00+09:00'))).toBe('20260703'); // 7월 3일
  });

  it('KST 자정 직후 UTC 인스턴트를 KST 날짜로 정확히 변환', () => {
    // 2026-07-03T00:30 KST == 2026-07-02T15:30Z. 서버 TZ 무관하게 20260703 이어야 함.
    expect(toKmaDate(new Date('2026-07-02T15:30:00Z'))).toBe('20260703');
  });
});

describe('getKstParts', () => {
  it('UTC 인스턴트를 Asia/Seoul 구성요소로 변환(+9h)', () => {
    const p = getKstParts(new Date('2026-07-03T00:00:00Z')); // KST 09:00
    expect(p).toMatchObject({ year: 2026, month: 7, day: 3, hour: 9, minute: 0 });
  });
});

describe('getBaseDateTime', () => {
  it('05:05 KST → 발표 후 10분 미경과라 이전 슬롯 0200', () => {
    expect(getBaseDateTime(new Date('2026-07-03T05:05:00+09:00'))).toEqual({
      baseDate: '20260703',
      baseTime: '0200',
    });
  });

  it('05:15 KST → 0500 발표 확정', () => {
    expect(getBaseDateTime(new Date('2026-07-03T05:15:00+09:00'))).toEqual({
      baseDate: '20260703',
      baseTime: '0500',
    });
  });

  it('01:00 KST(당일 0200 발표 전) → 전날 2300 으로 롤오버', () => {
    expect(getBaseDateTime(new Date('2026-07-03T01:00:00+09:00'))).toEqual({
      baseDate: '20260702',
      baseTime: '2300',
    });
  });

  it('월초 자정 직후에도 전월 말일 2300 으로 롤오버', () => {
    expect(getBaseDateTime(new Date('2026-07-01T00:30:00+09:00'))).toEqual({
      baseDate: '20260630',
      baseTime: '2300',
    });
  });

  it('23:30 KST → 당일 2300', () => {
    expect(getBaseDateTime(new Date('2026-07-03T23:30:00+09:00'))).toEqual({
      baseDate: '20260703',
      baseTime: '2300',
    });
  });

  it('서버 TZ 무관: UTC 로 표기한 동일 인스턴트도 동일 결과', () => {
    // 2026-07-03T01:00 KST == 2026-07-02T16:00Z
    expect(getBaseDateTime(new Date('2026-07-02T16:00:00Z'))).toEqual({
      baseDate: '20260702',
      baseTime: '2300',
    });
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
