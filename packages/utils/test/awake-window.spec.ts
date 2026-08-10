/// <reference types="jest" />

import {
  fitsInAwakeWindow,
  getAwakeWindow,
  getKstMinutes,
  minutesSinceWake,
} from '../src/awake-window';

/** KST 벽시계 시각 → Date */
function kst(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+09:00`);
}

describe('getKstMinutes', () => {
  it('reads the KST wall clock regardless of the UTC date rolling over', () => {
    // 00:30 KST 는 전날 15:30 UTC 다.
    expect(getKstMinutes(kst('2026-07-11', '00:30'))).toBe(30);
    expect(getKstMinutes(kst('2026-07-10', '10:00'))).toBe(600);
  });
});

describe('getAwakeWindow', () => {
  it('measures a same-day window', () => {
    expect(getAwakeWindow('07:00', '23:00')).toEqual({ wakeMinutes: 420, lengthMinutes: 960 });
  });

  it('measures a window that crosses midnight', () => {
    // 08:00 → 01:00 = 17시간
    expect(getAwakeWindow('08:00', '01:00')).toEqual({ wakeMinutes: 480, lengthMinutes: 1020 });
  });

  it('treats an equal wake and sleep time as a full day rather than zero', () => {
    // 0분으로 두면 모든 일정이 범위 밖이 되어 검증이 사용자를 막는 쪽으로 실패한다.
    expect(getAwakeWindow('08:00', '08:00').lengthMinutes).toBe(24 * 60);
  });
});

describe('minutesSinceWake', () => {
  it('counts forward from wake time across midnight', () => {
    expect(minutesSinceWake(600, 480)).toBe(120); // 10:00, 기상 08:00
    expect(minutesSinceWake(30, 480)).toBe(990); // 00:30 — 기상 다음 날로 넘어간 시각
  });
});

describe('fitsInAwakeWindow', () => {
  const sameDay = getAwakeWindow('07:00', '23:00');
  const crossesMidnight = getAwakeWindow('08:00', '01:00');

  it('accepts a visit inside a same-day window', () => {
    expect(fitsInAwakeWindow(600, 60, sameDay)).toBe(true);
  });

  it('rejects a visit that ends after sleep time', () => {
    // 22:30 + 60분 = 23:30 > 23:00
    expect(fitsInAwakeWindow(22 * 60 + 30, 60, sameDay)).toBe(false);
  });

  it('accepts a daytime visit when the window crosses midnight', () => {
    expect(fitsInAwakeWindow(600, 60, crossesMidnight)).toBe(true);
  });

  it('accepts a past-midnight visit that ends by sleep time', () => {
    // 00:00 + 60분 = 01:00 취침에 정확히 맞물린다.
    expect(fitsInAwakeWindow(0, 60, crossesMidnight)).toBe(true);
  });

  it('rejects a visit that runs past a post-midnight sleep time', () => {
    // 00:30 + 60분 = 01:30 > 01:00
    expect(fitsInAwakeWindow(30, 60, crossesMidnight)).toBe(false);
  });

  it('rejects a visit sitting in the sleep gap', () => {
    // 05:00 은 취침(01:00)~기상(08:00) 사이다.
    expect(fitsInAwakeWindow(5 * 60, 60, crossesMidnight)).toBe(false);
  });
});
