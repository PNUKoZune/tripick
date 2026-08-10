/**
 * 기상~취침 활동 구간(awake window) 계산 유틸
 *
 * 취침 시각은 기상보다 이를 수 있다(예: 기상 08:00 / 취침 01:00). 벽시계 분을 그대로
 * 비교하면 이 경우 `start >= wake && end <= sleep` 이 항상 거짓이 되어 정상 일정까지
 * 전부 범위 밖으로 판정된다. 그래서 "기상 이후 경과 분"이라는 선형 축으로 옮겨
 * 자정을 넘는 구간과 넘지 않는 구간을 같은 식으로 다룬다.
 */

import { getKstParts, timeToMinutes } from './date';

export const MINUTES_PER_DAY = 24 * 60;

/** 기상 시각을 원점으로 하는 활동 구간 */
export interface AwakeWindow {
  /** 기상 시각의 KST 벽시계 분 (구간의 원점) */
  wakeMinutes: number;
  /** 활동 구간 길이(분). 자정을 넘는 구간도 양수 길이로 표현된다. */
  lengthMinutes: number;
}

/** Date → KST 기준 벽시계 분(0~1439). 서버 타임존과 무관하게 계산한다. */
export function getKstMinutes(date: Date): number {
  const { hour, minute } = getKstParts(date);
  return hour * 60 + minute;
}

/**
 * "HH:mm" 기상·취침 시각 → 활동 구간.
 *
 * 취침이 기상보다 이르면 자정을 넘는 구간으로 해석한다(08:00~01:00 = 1020분).
 * 기상과 취침이 같으면 길이를 하루로 본다 — 0분으로 두면 모든 일정이 범위 밖이 되어,
 * 검증이 사용자를 막는 방향으로 실패한다. 이 값은 입력 단계에서 걸러지는 게 정상이다.
 */
export function getAwakeWindow(wakeTime: string, sleepTime: string): AwakeWindow {
  const wakeMinutes = timeToMinutes(wakeTime);
  const sleepMinutes = timeToMinutes(sleepTime);
  const span = (sleepMinutes - wakeMinutes + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return {
    wakeMinutes,
    lengthMinutes: span === 0 ? MINUTES_PER_DAY : span,
  };
}

/**
 * 기상 시각 이후 경과 분(0~1439). 활동 구간 안이면 lengthMinutes 이하,
 * 수면 구간이면 그보다 크다.
 */
export function minutesSinceWake(kstMinutes: number, wakeMinutes: number): number {
  return (kstMinutes - wakeMinutes + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/** 해당 시각에 시작하는 durationMin 분짜리 일정이 활동 구간 안에 온전히 들어가는지 */
export function fitsInAwakeWindow(
  kstMinutes: number,
  durationMin: number,
  window: AwakeWindow,
): boolean {
  const elapsed = minutesSinceWake(kstMinutes, window.wakeMinutes);
  return elapsed + durationMin <= window.lengthMinutes;
}
