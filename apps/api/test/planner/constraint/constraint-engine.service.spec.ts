/// <reference types="jest" />

import { ConstraintEngine } from '../../../src/planner/constraint/constraint.engine';
import { ScheduleConstraint } from '../../../src/planner/helpers/schedule.constraint';
import type { ItineraryItemDto } from '@tripick/types';

describe('ConstraintEngine', () => {
  const routeHelper = {
    getEta: jest.fn(),
  };
  const engine = new ConstraintEngine(routeHelper as any, new ScheduleConstraint());

  beforeEach(() => {
    routeHelper.getEta.mockReset();
  });

  it('marks visits outside opening hours as invalid', async () => {
    const result = await engine.validate(
      [
        item({
          name: '늦게 여는 카페',
          scheduledAt: kst('2026-07-10', '09:00'),
          durationMin: 60,
          openingHours: '10:00-18:00',
        }),
      ],
      { wakeTime: '08:00', sleepTime: '22:00', transportMode: 'transit' },
    );

    expect(result.valid).toBe(false);
    expect(result.issues.join('\n')).toContain('영업시간 외');
    expect(routeHelper.getEta).not.toHaveBeenCalled();
  });

  it('marks schedules with insufficient route buffer as invalid', async () => {
    routeHelper.getEta.mockResolvedValue({ durationSec: 30 * 60, distanceM: 2500 });

    const result = await engine.validate(
      [
        item({
          id: 'first',
          name: '첫 장소',
          scheduledAt: kst('2026-07-10', '09:00'),
          durationMin: 60,
        }),
        item({
          id: 'second',
          name: '다음 장소',
          order: 2,
          scheduledAt: kst('2026-07-10', '10:10'),
          durationMin: 60,
        }),
      ],
      { wakeTime: '08:00', sleepTime: '22:00', transportMode: 'transit' },
    );

    expect(result.valid).toBe(false);
    expect(result.issues.join('\n')).toContain('이동 시간 부족');
    expect(routeHelper.getEta).toHaveBeenCalledTimes(1);
    expect(routeHelper.getEta).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'transit');
  });

  it('passes walk through as walk instead of collapsing it to transit', async () => {
    // walk 가 transit 으로 새면 걸어서 못 가는 일정이 통과한다.
    routeHelper.getEta.mockResolvedValue({ durationSec: 30 * 60, distanceM: 2500 });

    await engine.validate(
      [
        item({ id: 'first', name: '첫 장소', scheduledAt: kst('2026-07-10', '09:00'), durationMin: 60 }),
        item({ id: 'second', name: '다음 장소', order: 2, scheduledAt: kst('2026-07-10', '10:10'), durationMin: 60 }),
      ],
      { wakeTime: '08:00', sleepTime: '22:00', transportMode: 'walk' },
    );

    expect(routeHelper.getEta).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'walk');
  });

  it('marks visits outside wake and sleep bounds as invalid', async () => {
    const result = await engine.validate(
      [
        item({
          name: '너무 긴 일정',
          scheduledAt: kst('2026-07-10', '09:00'),
          durationMin: 14 * 60,
        }),
      ],
      { wakeTime: '09:00', sleepTime: '21:00', transportMode: 'transit' },
    );

    expect(result.valid).toBe(false);
    expect(result.issues.join('\n')).toContain('기상/취침 시간 범위 밖');
  });

  it('구간 이동시간이 상한을 넘으면 위반으로 잡는다', async () => {
    // 지역을 이탈한 후보가 들어오면 "예약한 여유 ≥ 실제 ETA" 는 성립해도 하루가 통째로
    // 이동으로 사라진다(실측: 경주 여행에 단양 '경주식당', 457분).
    routeHelper.getEta.mockResolvedValue({ durationSec: 457 * 60, distanceM: 152_000 });

    const result = await engine.validate(
      [
        item({ id: 'a', name: '경주 서출지', scheduledAt: kst('2026-07-10', '09:00'), durationMin: 90 }),
        item({ id: 'b', name: '경주식당', order: 2, scheduledAt: kst('2026-07-10', '18:07'), durationMin: 80 }),
      ],
      { wakeTime: '07:30', sleepTime: '23:00', transportMode: 'transit' },
    );

    expect(result.valid).toBe(false);
    expect(result.issues.join('\n')).toContain('이동 시간 과다');
  });

  describe('tripStartDate 를 주면 일차 활동 구간을 절대 시각으로 본다', () => {
    it('날짜가 하루 밀린 항목을 잡는다', async () => {
      // 시각만 보는 검사는 이걸 통과시킨다 — 07:30 은 기상 시각이라 "범위 안"이다.
      const result = await engine.validate(
        [item({ name: '첨성대', day: 1, scheduledAt: kst('2026-07-11', '07:30'), durationMin: 90 })],
        {
          wakeTime: '07:30',
          sleepTime: '23:00',
          transportMode: 'transit',
          tripStartDate: '2026-07-10',
        },
      );

      expect(result.valid).toBe(false);
      expect(result.issues.join('\n')).toContain('1일차 활동 구간 밖');
    });

    it('취침이 자정을 넘는 여행의 자정 이후 일정은 정상으로 본다', async () => {
      // 날짜만 비교하면 이걸 전부 위반으로 잡아 재생성이 죽는다.
      const result = await engine.validate(
        [item({ name: '심야 포차', day: 1, scheduledAt: kst('2026-07-11', '00:00'), durationMin: 60 })],
        {
          wakeTime: '08:00',
          sleepTime: '01:00',
          transportMode: 'transit',
          tripStartDate: '2026-07-10',
        },
      );

      expect(result.valid).toBe(true);
    });

    it('2일차 항목은 시작일 + 1일 구간으로 본다', async () => {
      const result = await engine.validate(
        [item({ name: '해운대', day: 2, scheduledAt: kst('2026-07-11', '10:00'), durationMin: 90 })],
        {
          wakeTime: '08:00',
          sleepTime: '22:00',
          transportMode: 'transit',
          tripStartDate: '2026-07-10',
        },
      );

      expect(result.valid).toBe(true);
    });
  });

  describe('자정을 넘는 취침 시간 (기상 08:00 / 취침 01:00)', () => {
    const nightOwl = { wakeTime: '08:00', sleepTime: '01:00', transportMode: 'transit' } as const;

    it('accepts a daytime visit', async () => {
      const result = await engine.validate(
        [item({ name: '경복궁', scheduledAt: kst('2026-07-10', '10:00'), durationMin: 60 })],
        nightOwl,
      );

      expect(result.issues).toEqual([]);
      expect(result.valid).toBe(true);
    });

    it('accepts a visit that runs up to the post-midnight sleep time', async () => {
      const result = await engine.validate(
        [item({ name: '심야 포차', scheduledAt: kst('2026-07-11', '00:00'), durationMin: 60 })],
        nightOwl,
      );

      expect(result.valid).toBe(true);
    });

    it('marks a visit inside the sleep gap as invalid', async () => {
      // ScheduleConstraint 가 기상 이후로 밀지 못할 만큼 긴 일정이라야 위반으로 남는다.
      const result = await engine.validate(
        [item({ name: '새벽 일정', scheduledAt: kst('2026-07-10', '03:00'), durationMin: 22 * 60 })],
        nightOwl,
      );

      expect(result.valid).toBe(false);
      expect(result.issues.join('\n')).toContain('기상/취침 시간 범위 밖');
    });
  });
});

function item(overrides: Partial<ItineraryItemDto>): ItineraryItemDto {
  return {
    id: 'item-1',
    tripId: 'trip-1',
    day: 1,
    order: 1,
    type: 'cafe',
    name: '기본 장소',
    address: '부산 수영구 광안해변로 219',
    coordinates: { lat: 35.1532, lng: 129.1185 },
    scheduledAt: kst('2026-07-10', '09:00'),
    durationMin: 60,
    ...overrides,
  };
}

function kst(date: string, time: string): string {
  return new Date(`${date}T${time}:00+09:00`).toISOString();
}
