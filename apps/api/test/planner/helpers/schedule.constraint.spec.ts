/// <reference types="jest" />

import { ScheduleConstraint } from '../../../src/planner/helpers/schedule.constraint';
import type { ItineraryItemDto } from '@tripick/types';

const constraint = new ScheduleConstraint();

function item(over: Partial<ItineraryItemDto>): ItineraryItemDto {
  return {
    id: 'i1',
    tripId: 't1',
    day: 1,
    order: 1,
    type: 'attraction',
    name: '장소',
    address: '서울',
    coordinates: { lat: 37.5665, lng: 126.978 },
    scheduledAt: kst('2026-07-10', '10:00'),
    durationMin: 60,
    ...over,
  };
}

function kst(date: string, time: string): string {
  return new Date(`${date}T${time}:00+09:00`).toISOString();
}

/** ISO 문자열의 KST 벽시계 시각(HH:mm)을 되돌린다. */
function kstClock(iso: string): string {
  const d = new Date(iso);
  const kstMin = (d.getUTCHours() * 60 + d.getUTCMinutes() + 9 * 60) % (24 * 60);
  const h = String(Math.floor(kstMin / 60)).padStart(2, '0');
  const m = String(kstMin % 60).padStart(2, '0');
  return `${h}:${m}`;
}

describe('ScheduleConstraint.apply', () => {
  it('pushes a pre-wake item forward to wake time', () => {
    const [adjusted] = constraint.apply([item({ scheduledAt: kst('2026-07-10', '05:30') })], {
      wakeTime: '07:00',
      sleepTime: '23:00',
    });
    expect(kstClock(adjusted!.scheduledAt)).toBe('07:00');
  });

  it('pulls an item that would end after sleep time back so it finishes by then', () => {
    const [adjusted] = constraint.apply(
      [item({ scheduledAt: kst('2026-07-10', '22:40'), durationMin: 60 })],
      { wakeTime: '07:00', sleepTime: '23:00' },
    );
    // 23:00 취침 - 60분 → 22:00 시작
    expect(kstClock(adjusted!.scheduledAt)).toBe('22:00');
  });

  it('leaves an in-bounds item untouched', () => {
    const original = item({ scheduledAt: kst('2026-07-10', '14:00') });
    const [adjusted] = constraint.apply([original], { wakeTime: '07:00', sleepTime: '23:00' });
    expect(adjusted!.scheduledAt).toBe(original.scheduledAt);
  });

  it('does not shift below wake time when duration cannot fit before sleep', () => {
    // 22:00 시작 + 240분 = 02:00 → sleep(23:00) 초과지만 당기면 wake 이전이라 그대로 둔다.
    const original = item({ scheduledAt: kst('2026-07-10', '22:00'), durationMin: 240 });
    const [adjusted] = constraint.apply([original], { wakeTime: '21:30', sleepTime: '23:00' });
    expect(adjusted!.scheduledAt).toBe(original.scheduledAt);
  });
});

describe('ScheduleConstraint.describeConstraints', () => {
  it('renders wake and sleep bounds as a prompt hint', () => {
    expect(constraint.describeConstraints({ wakeTime: '08:00', sleepTime: '22:00' })).toContain(
      '기상: 08:00',
    );
  });
});
