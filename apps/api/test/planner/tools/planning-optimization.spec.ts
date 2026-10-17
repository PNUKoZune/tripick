/// <reference types="jest" />

import { ConflictException, Logger, RequestTimeoutException } from '@nestjs/common';
import type { Coordinates, ItineraryItemDto } from '@tripick/types';
import { ConstraintEngine } from '../../../src/planner/constraint/constraint.engine';
import { ScheduleConstraint } from '../../../src/planner/helpers/schedule.constraint';
import { PlanningToolsService } from '../../../src/planner/tools/planning-tools.service';
import type {
  PlanningSnapshot,
  StoredPlanningCandidate,
} from '../../../src/planner/tools/planning.contract';

const OWNER = 'owner';
const TRIP_ID = 'trip';
const FUTURE_DATE = '2099-04-20';

function visit(id: string, order: number, hour: number, day = 1): ItineraryItemDto {
  const coordinates = { lat: 37 + (id.charCodeAt(0) - 96) / 100, lng: 127 };
  return {
    id,
    tripId: TRIP_ID,
    day,
    order,
    type: 'attraction',
    name: `Place ${id}`,
    address: `Address ${id}`,
    coordinates,
    scheduledAt: `2099-04-${day === 1 ? '20' : '21'}T${String(hour).padStart(2, '0')}:00:00+09:00`,
    durationMin: 30,
    openingHours: '00:00-24:00',
    memo: `Saved memo ${id}`,
    travelTimeMin: 0,
  };
}

function placeId(coordinates: Coordinates): string {
  if (coordinates.lat === 36) return 'origin';
  return String.fromCharCode(96 + Math.round((coordinates.lat - 37) * 100));
}

function setup(
  input: ItineraryItemDto[],
  routeMinutes: (from: string, to: string) => number | Promise<number>,
) {
  const saved = input.map((item) => ({
    ...structuredClone(item),
    scheduledAt: new Date(item.scheduledAt),
  }));
  const sourceBefore = structuredClone(saved);
  const trip = {
    id: TRIP_ID,
    userId: OWNER,
    title: 'Future trip',
    destination: 'Seoul',
    startDate: FUTURE_DATE,
    endDate: input.some((item) => item.day === 2) ? '2099-04-21' : FUTURE_DATE,
    wakeTime: '09:00',
    sleepTime: '23:00',
    transportMode: 'walk',
    status: 'draft',
  };
  const snapshots = new Map<string, PlanningSnapshot>();
  const candidates = new Map<string, StoredPlanningCandidate>();
  let running: string | undefined;
  const store = {
    putSnapshot: jest.fn(async (snapshot: PlanningSnapshot) => {
      snapshots.set(snapshot.snapshotId, structuredClone(snapshot));
    }),
    getSnapshot: jest.fn(async (id: string) => structuredClone(snapshots.get(id) ?? null)),
    putCandidate: jest.fn(async (candidate: StoredPlanningCandidate) => {
      candidates.set(candidate.evaluation.candidateId, structuredClone(candidate));
    }),
    getCandidate: jest.fn(async (id: string) => structuredClone(candidates.get(id) ?? null)),
    acquire: jest.fn(async (_id: string, token: string) => {
      if (running) return false;
      running = token;
      return true;
    }),
    release: jest.fn(async (_id: string, token: string) => {
      if (running === token) running = undefined;
    }),
  };
  const routes = {
    getEta: jest.fn(async (from: Coordinates, to: Coordinates) => ({
      durationSec: (await routeMinutes(placeId(from), placeId(to))) * 60,
      distanceM: 100,
    })),
  };
  const constraints = new ConstraintEngine(routes as never, new ScheduleConstraint());
  const itinerary = {
    findByTrip: jest.fn(async () => structuredClone(saved)),
    replaceByTrip: jest.fn(),
  };
  const service = new PlanningToolsService(
    { findOneBy: jest.fn(async () => structuredClone(trip)) } as never,
    { find: jest.fn(async () => []) } as never,
    itinerary as never,
    { findByUser: jest.fn(async () => null) } as never,
    { forTrip: jest.fn(async () => null) } as never,
    { retrieve: jest.fn() } as never,
    constraints,
    routes as never,
    store as never,
    { get: () => 'true' } as never,
  );
  return { service, store, routes, saved, sourceBefore, itinerary, candidates, trip };
}

function itemIds(items: ItineraryItemDto[]): string[] {
  return items.map((item) => item.id);
}

describe('PlanningToolsService optimization with ConstraintEngine', () => {
  let silenceWarnings: jest.SpyInstance;

  beforeEach(() => {
    silenceWarnings = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => silenceWarnings.mockRestore());

  it('reorders persisted order slots, reflows times and improves actual route ETA without saving itinerary', async () => {
    const input = [visit('a', 1, 9), visit('b', 2, 12), visit('c', 3, 15)];
    const harness = setup(input, (from, to) => {
      if (`${from}${to}` === 'ba' || `${from}${to}` === 'ac') return 10;
      return 100;
    });
    const context = await harness.service.getContext(OWNER, TRIP_ID);
    const result = await harness.service.optimize(OWNER, TRIP_ID, {
      snapshotId: context.snapshotId,
      snapshotVersion: context.snapshotVersion,
    });

    expect(result.violations).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.before.metrics.travelTimeMin).toBe(200);
    expect(result.after.metrics.travelTimeMin).toBe(20);
    expect(itemIds(result.items)).toEqual(['b', 'a', 'c']);
    expect(result.items.map((item) => item.order)).toEqual([1, 2, 3]);
    expect(result.items.map((item) => item.scheduledAt)).toEqual([
      '2099-04-20T00:00:00.000Z',
      '2099-04-20T00:40:00.000Z',
      '2099-04-20T01:20:00.000Z',
    ]);
    expect(result.items.map((item) => item.travelTimeMin)).toEqual([10, 10, undefined]);
    expect(harness.saved).toEqual(harness.sourceBefore);
    expect(harness.itinerary.replaceByTrip).not.toHaveBeenCalled();
    expect(harness.store.putCandidate).toHaveBeenCalledTimes(1);
    expect(harness.candidates.get(result.candidateId)?.evaluation.items).toEqual(result.items);
    expect(harness.store.release).toHaveBeenCalledTimes(1);
  });

  it('keeps locked values and barriers exact and never moves an item to another day', async () => {
    const input = [
      visit('a', 1, 9),
      visit('b', 2, 10),
      visit('c', 3, 13),
      visit('d', 4, 15),
      visit('e', 5, 17),
      visit('f', 1, 9, 2),
      visit('g', 2, 11, 2),
    ];
    input[2]!.type = 'accommodation';
    const harness = setup(input, (from, to) =>
      ['ba', 'de', 'gf'].includes(`${from}${to}`) ? 1 : 10,
    );
    const context = await harness.service.getContext(OWNER, TRIP_ID, { lockedItemIds: ['c'] });
    const locked = context.items.find((item) => item.id === 'c');
    const result = await harness.service.optimize(OWNER, TRIP_ID, {
      snapshotId: context.snapshotId,
      snapshotVersion: context.snapshotVersion,
    });

    expect(result.valid).toBe(true);
    expect(result.items[2]).toEqual(locked);
    expect(new Set(itemIds(result.items.slice(0, 2)))).toEqual(new Set(['a', 'b']));
    expect(new Set(itemIds(result.items.slice(3, 5)))).toEqual(new Set(['d', 'e']));
    expect(
      result.items
        .filter((item) => item.day === 2)
        .map((item) => item.id)
        .sort(),
    ).toEqual(['f', 'g']);
    expect(
      result.items.every((item) => item.day === input.find((saved) => saved.id === item.id)!.day),
    ).toBe(true);
    expect(harness.saved).toEqual(harness.sourceBefore);
  });

  it('includes a future origin leg in both arrival feasibility and route objective', async () => {
    const harness = setup([visit('a', 1, 10), visit('b', 2, 11)], (from, to) => {
      if (from === 'origin') return to === 'a' ? 50 : 1;
      return `${from}${to}` === 'ba' ? 2 : 1;
    });
    const context = await harness.service.getContext(OWNER, TRIP_ID, {
      origin: { lat: 36, lng: 127 },
    });
    const result = await harness.service.optimize(OWNER, TRIP_ID, {
      snapshotId: context.snapshotId,
      snapshotVersion: context.snapshotVersion,
    });

    expect(result.valid).toBe(true);
    expect(result.before.valid).toBe(true);
    expect(result.before.metrics.travelTimeMin).toBe(51);
    expect(result.metrics.travelTimeMin).toBe(3);
    expect(itemIds(result.items)).toEqual(['b', 'a']);
    expect(result.items[0]!.scheduledAt).toBe('2099-04-20T00:01:00.000Z');
    expect(result.items[1]!.scheduledAt).toBe('2099-04-20T00:33:00.000Z');
  });

  it.each(['09:00-23:00', '00:00-24:00'])(
    'does not defer an evening visit to the next morning when opening hours are %s',
    async (openingHours) => {
      const input = [visit('a', 1, 20), visit('b', 2, 22)];
      input.forEach((item) => {
        item.openingHours = openingHours;
      });
      const harness = setup(input, (from, to) => (`${from}${to}` === 'ba' ? 1 : 50));
      harness.trip.wakeTime = '20:00';
      harness.trip.sleepTime = '04:00';
      const context = await harness.service.getContext(OWNER, TRIP_ID);
      const result = await harness.service.optimize(OWNER, TRIP_ID, {
        snapshotId: context.snapshotId,
        snapshotVersion: context.snapshotVersion,
      });

      expect(result.valid).toBe(true);
      expect(result.metrics.travelTimeMin).toBe(1);
      expect(itemIds(result.items)).toEqual(['b', 'a']);
      expect(result.items[0]!.scheduledAt).toBe('2099-04-20T11:00:00.000Z');
    },
  );

  it('retains unknown opening hours while improving a route', async () => {
    const input = [visit('a', 1, 9), visit('b', 2, 11)];
    input.forEach((item) => {
      item.openingHours = '99:99-99:99';
    });
    const harness = setup(input, (from, to) => (`${from}${to}` === 'ba' ? 1 : 50));
    const context = await harness.service.getContext(OWNER, TRIP_ID);
    const result = await harness.service.optimize(OWNER, TRIP_ID, {
      snapshotId: context.snapshotId,
      snapshotVersion: context.snapshotVersion,
    });

    expect(result.valid).toBe(true);
    expect(result.metrics.travelTimeMin).toBe(1);
    expect(result.unknownConstraints).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'OPENING_HOURS_UNPARSEABLE' })]),
    );
  });

  it('returns the last validated draft within its budget when a reordered route does not settle', async () => {
    let finishRoute: ((minutes: number) => void) | undefined;
    const harness = setup([visit('a', 1, 9), visit('b', 2, 11)], (from, to) => {
      if (`${from}${to}` === 'ba')
        return new Promise<number>((resolve) => {
          finishRoute = resolve;
        });
      return 1;
    });
    const context = await harness.service.getContext(OWNER, TRIP_ID);
    const result = await harness.service.optimize(OWNER, TRIP_ID, {
      snapshotId: context.snapshotId,
      snapshotVersion: context.snapshotVersion,
      timeBudgetMs: 25,
    });
    finishRoute?.(1);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(result.terminationReason).toBe('TIME_LIMIT');
    expect(result.after.valid).toBe(true);
    expect(itemIds(result.items)).toEqual(['a', 'b']);
    expect(result.metrics.travelTimeMin).toBe(1);
    expect(harness.store.release).toHaveBeenCalledTimes(1);
    expect(harness.saved).toEqual(harness.sourceBefore);
  });

  it('shares route queries across reflow, constraint validation and origin evaluation', async () => {
    const harness = setup([visit('a', 1, 10), visit('b', 2, 13), visit('c', 3, 16)], (from, to) => {
      if (from === 'origin') return 1;
      return ['ba', 'ac'].includes(`${from}${to}`) ? 10 : 100;
    });
    const context = await harness.service.getContext(OWNER, TRIP_ID, {
      origin: { lat: 36, lng: 127 },
    });
    const result = await harness.service.optimize(OWNER, TRIP_ID, {
      snapshotId: context.snapshotId,
      snapshotVersion: context.snapshotVersion,
    });
    const routeKeys = harness.routes.getEta.mock.calls.map(
      ([from, to]) => `${placeId(from)}:${placeId(to)}`,
    );

    expect(result.valid).toBe(true);
    expect(result.evaluations).toBeGreaterThan(2);
    expect(result.metrics.travelTimeMin).toBe(21);
    expect(routeKeys.filter((key) => key === 'b:a')).toHaveLength(1);
    expect(routeKeys.filter((key) => key === 'origin:b')).toHaveLength(1);
    expect(new Set(routeKeys).size).toBe(routeKeys.length);
    expect(result.routeLookups).toBe(routeKeys.length);
  });

  it('caps route lookup fan-out at 128 for a 100-item, 50-evaluation search', async () => {
    const start = Date.parse(`${FUTURE_DATE}T09:00:00+09:00`);
    const input = Array.from({ length: 100 }, (_, index) => ({
      ...visit(`item-${index}`, index + 1, 9),
      coordinates: { lat: 37 + index / 100, lng: 127 },
      scheduledAt: new Date(start + index * 2 * 60_000).toISOString(),
      durationMin: 1,
    }));
    const harness = setup(input, () => 1);
    const context = await harness.service.getContext(OWNER, TRIP_ID);
    const result = await harness.service.optimize(OWNER, TRIP_ID, {
      snapshotId: context.snapshotId,
      snapshotVersion: context.snapshotVersion,
      maxEvaluations: 50,
      timeBudgetMs: 2_000,
    });

    expect(result.valid).toBe(true);
    expect(result.evaluations).toBe(50);
    expect(result.routeLookupLimit).toBe(128);
    expect(result.routeLookups).toBe(128);
    expect(harness.routes.getEta).toHaveBeenCalledTimes(128);
    expect(result.terminationReason).toBe('ROUTE_LOOKUP_LIMIT');
    expect(result.metrics.travelTimeMin).toBe(99);
    expect(itemIds(result.items)).toEqual(itemIds(input));
  });

  it('does not start another route after cancellation while baseline routing is in progress', async () => {
    const controller = new AbortController();
    const requestsAfterCancellation: string[] = [];
    const harness = setup([visit('a', 1, 10), visit('b', 2, 12)], (from, to) => {
      if (controller.signal.aborted) requestsAfterCancellation.push(`${from}:${to}`);
      if (`${from}${to}` === 'ab') controller.abort();
      return 1;
    });
    const context = await harness.service.getContext(OWNER, TRIP_ID, {
      origin: { lat: 36, lng: 127 },
    });

    await expect(
      harness.service.optimize(
        OWNER,
        TRIP_ID,
        {
          snapshotId: context.snapshotId,
          snapshotVersion: context.snapshotVersion,
        },
        controller.signal,
      ),
    ).rejects.toBeInstanceOf(RequestTimeoutException);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(requestsAfterCancellation).toEqual([]);
    expect(harness.routes.getEta).toHaveBeenCalledTimes(1);
    expect(harness.store.release).toHaveBeenCalledTimes(1);
  });

  it('does not publish a draft after the source itinerary changes during computation', async () => {
    let mutateSource = false;
    const harness = setup([visit('a', 1, 9), visit('b', 2, 11)], () => {
      if (mutateSource) harness.saved[0]!.memo = 'concurrent itinerary edit';
      return 1;
    });
    const context = await harness.service.getContext(OWNER, TRIP_ID);
    mutateSource = true;

    await expect(
      harness.service.optimize(OWNER, TRIP_ID, {
        snapshotId: context.snapshotId,
        snapshotVersion: context.snapshotVersion,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(harness.store.putCandidate).not.toHaveBeenCalled();
    expect(harness.store.release).toHaveBeenCalledTimes(1);
  });
});
