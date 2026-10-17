/// <reference types="jest" />

import { ConstraintEngine } from '../../../src/planner/constraint/constraint.engine';
import { ScheduleConstraint } from '../../../src/planner/helpers/schedule.constraint';
import type { RouteHelper } from '../../../src/planner/helpers/route.helper';
import type { ItineraryItemDto } from '@tripick/types';

describe('ConstraintEngine structured contract', () => {
  const routeHelper = { getEta: jest.fn() };
  let scheduleConstraint: ScheduleConstraint;
  let engine: ConstraintEngine;

  beforeEach(() => {
    routeHelper.getEta.mockReset().mockResolvedValue({ durationSec: 20 * 60, distanceM: 2000 });
    scheduleConstraint = new ScheduleConstraint();
    engine = new ConstraintEngine(routeHelper as unknown as RouteHelper, scheduleConstraint);
  });

  afterEach(() => jest.useRealTimers());

  it('clones unchanged inputs and audits normalized timestamps without mutating the caller', async () => {
    const input = [item({ scheduledAt: at('06:00') }), item({ id: 'second', day: 2 })];
    const original = structuredClone(input);
    const result = await engine.validate(input, { wakeTime: '08:00', sleepTime: '22:00' });

    expect(input).toEqual(original);
    expect(result.items).toBe(result.normalizedItems);
    expect(result.normalizedItems[0]!.scheduledAt).toBe(at('08:00'));
    expect(result.normalizationChanges).toEqual([
      {
        itemId: 'first',
        field: 'scheduledAt',
        before: at('06:00'),
        after: at('08:00'),
        reason: expect.any(String),
      },
    ]);
    expect(result.normalizedItems[1]).not.toBe(input[1]);
    expect(result.normalizedItems[1]!.coordinates).not.toBe(input[1]!.coordinates);
    result.normalizedItems[1]!.coordinates.lat = 0;
    expect(input).toEqual(original);
  });

  it('reports unknown opening hours separately from actual violations', async () => {
    const missing = item({ id: 'missing' });
    delete missing.openingHours;
    const result = await engine.validate([
      missing,
      item({ id: 'unparseable', day: 2, openingHours: '매주 월요일 휴무' }),
      item({ id: 'invalid-clock', day: 3, openingHours: '99:00-25:30' }),
    ]);

    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.unknownConstraints.map(({ code, itemId }) => ({ code, itemId }))).toEqual([
      { code: 'OPENING_HOURS_MISSING', itemId: 'missing' },
      { code: 'OPENING_HOURS_UNPARSEABLE', itemId: 'unparseable' },
      { code: 'OPENING_HOURS_UNPARSEABLE', itemId: 'invalid-clock' },
    ]);
    expect(result.travelTimeMin).toBe(0);
  });

  it.each([
    ['invalid timestamp', { scheduledAt: 'bad-date' }],
    ['nonexistent date', { scheduledAt: '2026-02-30T09:00:00+09:00' }],
    ['missing timezone', { scheduledAt: '2026-07-10T09:00:00' }],
    ['invalid latitude', { coordinates: { lat: NaN, lng: 129 } }],
    ['out-of-range longitude', { coordinates: { lat: 35, lng: 181 } }],
    ['missing coordinates', { coordinates: undefined }],
    ['zero day', { day: 0 }],
    ['fractional day', { day: 1.5 }],
    ['invalid order', { order: NaN }],
    ['zero duration', { durationMin: 0 }],
    ['negative duration', { durationMin: -1 }],
    ['infinite duration', { durationMin: Infinity }],
  ])('rejects %s before normalization or route lookup', async (_label, overrides) => {
    const apply = jest.spyOn(scheduleConstraint, 'apply');
    const input = [item(overrides as Partial<ItineraryItemDto>)];
    const result = await engine.validate(input);

    expect(result.valid).toBe(false);
    expect(result.violations[0]).toMatchObject({ code: 'INVALID_INPUT', itemId: 'first' });
    expect(result.normalizationChanges).toEqual([]);
    expect(result.travelTimeMin).toBeNull();
    expect(apply).not.toHaveBeenCalled();
    expect(routeHelper.getEta).not.toHaveBeenCalled();
  });

  it.each([
    { wakeTime: '25:00' },
    { sleepTime: '12:90' },
    { tripStartDate: '2026-02-30' },
    { routeTimeoutMs: 0 },
    { routeTimeoutMs: NaN },
  ])('rejects malformed options %o safely', async (options) => {
    const result = await engine.validate([item({})], options);
    expect(result.violations[0]!.code).toBe('INVALID_INPUT');
    expect(routeHelper.getEta).not.toHaveBeenCalled();
  });

  it('handles malformed item collections without throwing', async () => {
    const malformed = [null] as unknown as ItineraryItemDto[];
    expect((await engine.validate(malformed)).violations[0]!.code).toBe('INVALID_INPUT');
    expect((await engine.validate(null as unknown as ItineraryItemDto[])).violations[0]!.code).toBe(
      'INVALID_INPUT',
    );
  });

  it('checks route legs in same-day persisted order even when request order is interleaved', async () => {
    const first = item({ id: 'first', coordinates: { lat: 35, lng: 129 } });
    const second = item({
      id: 'second',
      order: 2,
      scheduledAt: at('10:30'),
      coordinates: { lat: 36, lng: 128 },
    });
    const otherDay = item({ id: 'other-day', day: 2 });
    const result = await engine.validate([second, otherDay, first]);

    expect(routeHelper.getEta).toHaveBeenCalledTimes(1);
    expect(routeHelper.getEta).toHaveBeenCalledWith(
      first.coordinates,
      second.coordinates,
      'transit',
    );
    expect(result.normalizedItems.map(({ id }) => id)).toEqual(['second', 'other-day', 'first']);
    expect(result.valid).toBe(true);
    expect(result.travelTimeMin).toBe(20);
  });

  it('returns structured route violations and the original legacy messages', async () => {
    const result = await engine.validate(pair('10:10'));

    expect(result.violations).toEqual([
      expect.objectContaining({
        code: 'INSUFFICIENT_TRAVEL_TIME',
        itemId: 'first',
        relatedItemId: 'second',
      }),
    ]);
    expect(result.issues).toEqual(result.violations.map(({ message }) => message));
    expect(result.travelTimeMin).toBe(20);
  });

  it('fails validation explicitly when a route is unavailable', async () => {
    routeHelper.getEta.mockRejectedValue(new Error('upstream unavailable'));
    const result = await engine.validate(pair());

    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      expect.objectContaining({
        code: 'ROUTE_UNAVAILABLE',
        itemId: 'first',
        relatedItemId: 'second',
      }),
    ]);
    expect(result.unknownConstraints).toContainEqual(
      expect.objectContaining({ code: 'ROUTE_UNAVAILABLE' }),
    );
    expect(result.travelTimeMin).toBeNull();
  });

  it.each([NaN, Infinity, -1])('rejects malformed route durations: %s', async (durationSec) => {
    routeHelper.getEta.mockResolvedValue({ durationSec, distanceM: 1 });
    const result = await engine.validate(pair());
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.code).toBe('ROUTE_UNAVAILABLE');
    expect(result.travelTimeMin).toBeNull();
  });

  it('bounds a pending route lookup by the requested timeout', async () => {
    jest.useFakeTimers();
    routeHelper.getEta.mockImplementation(() => new Promise(() => undefined));
    const pending = engine.validate(pair(), { routeTimeoutMs: 50 });
    await jest.advanceTimersByTimeAsync(50);
    const result = await pending;

    expect(result.valid).toBe(false);
    expect(result.violations[0]!.code).toBe('ROUTE_UNAVAILABLE');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('can stop waiting for an in-progress route on abort', async () => {
    routeHelper.getEta.mockImplementation(() => new Promise(() => undefined));
    const controller = new AbortController();
    const pending = engine.validate(pair(), { signal: controller.signal });
    await Promise.resolve();
    controller.abort();

    expect((await pending).valid).toBe(false);
  });

  it('skips route lookup when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await engine.validate(pair(), { signal: controller.signal });
    expect(result.valid).toBe(false);
    expect(routeHelper.getEta).not.toHaveBeenCalled();
  });

  it('supports overnight opening hours and a 24:00 closing time', async () => {
    const result = await engine.validate(
      [
        item({ openingHours: '18:00-02:00', scheduledAt: at('00:00') }),
        item({ id: 'all-day', day: 2, openingHours: '00:00-24:00' }),
      ],
      { wakeTime: '08:00', sleepTime: '02:00' },
    );

    expect(result.valid).toBe(true);
    expect(result.unknownConstraints).toEqual([]);
  });
});

function item(overrides: Partial<ItineraryItemDto>): ItineraryItemDto {
  return {
    id: 'first',
    tripId: 'trip-1',
    day: 1,
    order: 1,
    type: 'cafe',
    name: '방문 장소',
    address: '부산',
    coordinates: { lat: 35.1532, lng: 129.1185 },
    scheduledAt: at('09:00'),
    durationMin: 60,
    openingHours: '00:00-24:00',
    ...overrides,
  };
}

function pair(secondTime = '10:30'): ItineraryItemDto[] {
  return [item({}), item({ id: 'second', order: 2, scheduledAt: at(secondTime) })];
}

function at(time: string): string {
  return new Date(`2026-07-10T${time}:00+09:00`).toISOString();
}
