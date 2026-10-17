/// <reference types="jest" />

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  RequestTimeoutException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import type { ItineraryItemDto } from '@tripick/types';
import { PlanningToolsService } from '../../../src/planner/tools/planning-tools.service';
import type {
  PlanningSnapshot,
  StoredPlanningCandidate,
} from '../../../src/planner/tools/planning.contract';
import type { PlanningDraftDto } from '../../../src/planner/tools/planning.dto';
import type { PlanningSnapshotStore } from '../../../src/planner/tools/planning-snapshot.store';
import { ConstraintEngine } from '../../../src/planner/constraint/constraint.engine';
import { ScheduleConstraint } from '../../../src/planner/helpers/schedule.constraint';
import type { RouteHelper } from '../../../src/planner/helpers/route.helper';
import type { TripEntity } from '../../../src/trips/trip.entity';
import type { TripDayEntity } from '../../../src/trips/trip-day.entity';
import type { ItineraryItemEntity } from '../../../src/itinerary/itinerary-item.entity';
import type { ItineraryService } from '../../../src/itinerary/itinerary.service';
import type { PreferencesService } from '../../../src/preferences/preferences.service';
import type { GroupPreferenceService } from '../../../src/planner/retrieval/group-preference.service';
import type { PlaceRetrievalService } from '../../../src/planner/retrieval/place-retrieval.service';

const OWNER = 'owner';
const TRIP_ID = 'b27306f4-b92f-4987-9cf2-59d763704cdf';
const NOW = Date.parse('2026-10-18T01:00:00Z');

describe('PlanningToolsService', () => {
  let service: PlanningToolsService;
  let trip: TripEntity;
  let days: TripDayEntity[];
  let savedItems: ItineraryItemEntity[];
  let snapshots: Map<string, PlanningSnapshot>;
  let candidates: Map<string, StoredPlanningCandidate>;
  const flags: Record<string, string> = {};
  const tripsRepo = { findOneBy: jest.fn(), save: jest.fn(), update: jest.fn() };
  const daysRepo = { find: jest.fn(), save: jest.fn(), delete: jest.fn() };
  const itinerary = {
    findByTrip: jest.fn(),
    replaceForTrip: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };
  const preferences = { findByUser: jest.fn() };
  const group = { forTrip: jest.fn() };
  const retrieval = { retrieve: jest.fn() };
  const routes = { getEta: jest.fn() };
  const store = {
    putSnapshot: jest.fn(),
    getSnapshot: jest.fn(),
    putCandidate: jest.fn(),
    getCandidate: jest.fn(),
    acquire: jest.fn(),
    release: jest.fn(),
  };

  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers({
      now: NOW,
      doNotFake: [
        'performance',
        'hrtime',
        'nextTick',
        'setImmediate',
        'clearImmediate',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
      ],
    });
    Object.assign(flags, { PLANNING_TOOLS_ENABLED: 'true', PLANNING_LOCAL_SEARCH_ENABLED: 'true' });
    trip = {
      id: TRIP_ID,
      userId: OWNER,
      title: '부산 여행',
      destination: '부산',
      startDate: '2026-10-20',
      endDate: '2026-10-21',
      wakeTime: '08:00',
      sleepTime: '22:00',
      transportMode: 'transit',
      status: 'draft',
      updatedAt: new Date(NOW),
      createdAt: new Date(NOW),
      notes: null,
      shareToken: null,
    } as TripEntity;
    days = [
      { id: 'day-1', tripId: TRIP_ID, day: 1, region: '부산', sortOrder: 0 },
    ] as TripDayEntity[];
    savedItems = [
      entity(item()),
      entity(
        item({
          id: 'second',
          order: 2,
          scheduledAt: at('11:00'),
          coordinates: { lat: 35.2, lng: 129 },
        }),
      ),
    ];
    snapshots = new Map();
    candidates = new Map();
    tripsRepo.findOneBy.mockImplementation(async () => structuredClone(trip));
    daysRepo.find.mockImplementation(async () => structuredClone(days));
    itinerary.findByTrip.mockImplementation(async () => structuredClone(savedItems));
    preferences.findByUser.mockResolvedValue({ profile: { pace: 'balanced' }, tasteTags: {} });
    group.forTrip.mockResolvedValue(null);
    retrieval.retrieve.mockResolvedValue({ places: [] });
    routes.getEta.mockResolvedValue({ durationSec: 20 * 60, distanceM: 2000 });
    store.putSnapshot.mockImplementation(async (snapshot: PlanningSnapshot) => {
      snapshots.set(snapshot.snapshotId, structuredClone(snapshot));
    });
    store.getSnapshot.mockImplementation(async (id: string) =>
      snapshots.has(id) ? structuredClone(snapshots.get(id)!) : null,
    );
    store.putCandidate.mockImplementation(async (candidate: StoredPlanningCandidate) => {
      candidates.set(candidate.evaluation.candidateId, structuredClone(candidate));
    });
    store.getCandidate.mockImplementation(async (id: string) =>
      candidates.has(id) ? structuredClone(candidates.get(id)!) : null,
    );
    store.acquire.mockResolvedValue(true);
    store.release.mockResolvedValue(undefined);
    const constraints = new ConstraintEngine(
      routes as unknown as RouteHelper,
      new ScheduleConstraint(),
    );
    service = new PlanningToolsService(
      tripsRepo as unknown as Repository<TripEntity>,
      daysRepo as unknown as Repository<TripDayEntity>,
      itinerary as unknown as ItineraryService,
      preferences as unknown as PreferencesService,
      group as unknown as GroupPreferenceService,
      retrieval as unknown as PlaceRetrievalService,
      constraints,
      routes as unknown as RouteHelper,
      store as unknown as PlanningSnapshotStore,
      { get: (key: string) => flags[key] } as unknown as ConfigService,
    );
  });

  afterEach(() => {
    expect(tripsRepo.save).not.toHaveBeenCalled();
    expect(tripsRepo.update).not.toHaveBeenCalled();
    expect(daysRepo.save).not.toHaveBeenCalled();
    expect(daysRepo.delete).not.toHaveBeenCalled();
    expect(itinerary.replaceForTrip).not.toHaveBeenCalled();
    expect(itinerary.update).not.toHaveBeenCalled();
    expect(itinerary.remove).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  async function context() {
    return service.getContext(OWNER, TRIP_ID);
  }
  function draft(
    snapshot: Pick<PlanningSnapshot, 'snapshotId' | 'snapshotVersion'>,
    items?: ItineraryItemDto[],
  ): PlanningDraftDto {
    return {
      snapshotId: snapshot.snapshotId,
      snapshotVersion: snapshot.snapshotVersion,
      ...(items ? { items } : {}),
    };
  }

  it('creates an expiring owner-scoped snapshot without leaking the owner or refreshing unnecessarily', async () => {
    const result = await context();
    expect(result).not.toHaveProperty('ownerId');
    expect(result.snapshotVersion).toMatch(/^[a-f0-9]{64}$/);
    expect(Date.parse(result.expiresAt) - Date.parse(result.createdAt)).toBe(15 * 60_000);
    expect(result.terminationReason).toBe('CONTEXT_READY');
    expect(snapshots.get(result.snapshotId)!.ownerId).toBe(OWNER);
    expect(retrieval.retrieve).not.toHaveBeenCalled();
  });

  it('hides disabled tools and denies trips owned by another user', async () => {
    flags.PLANNING_TOOLS_ENABLED = 'false';
    await expect(context()).rejects.toBeInstanceOf(NotFoundException);
    flags.PLANNING_TOOLS_ENABLED = 'true';
    await expect(service.getContext('other-user', TRIP_ID)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(store.putSnapshot).not.toHaveBeenCalled();
  });

  it.each(['owner', 'trip', 'expiry', 'version', 'constraint', 'schema', 'algorithm'] as const)(
    'rejects a snapshot with mismatched %s',
    async (kind) => {
      const result = await context();
      const snapshot = snapshots.get(result.snapshotId)!;
      if (kind === 'owner') snapshot.ownerId = 'other-user';
      if (kind === 'trip') snapshot.trip.id = 'other-trip';
      if (kind === 'expiry') snapshot.expiresAt = new Date(NOW).toISOString();
      if (kind === 'version') snapshot.snapshotVersion = 'new-version';
      if (kind === 'constraint') snapshot.constraintVersion = 'old-constraint';
      if (kind === 'schema') snapshot.schemaVersion = 'old-schema';
      if (kind === 'algorithm') snapshot.algorithmVersion = 'old-algorithm';
      const error = ['version', 'constraint', 'schema', 'algorithm'].includes(kind)
        ? ConflictException
        : NotFoundException;
      await expect(service.validate(OWNER, TRIP_ID, draft(result))).rejects.toBeInstanceOf(error);
      expect(store.putCandidate).not.toHaveBeenCalled();
    },
  );

  it.each(['trip', 'item', 'day'] as const)(
    'detects concurrent %s changes in the content fingerprint',
    async (kind) => {
      const result = await context();
      if (kind === 'trip') trip.sleepTime = '21:00';
      if (kind === 'item') savedItems[0]!.memo = 'edited concurrently';
      if (kind === 'day') days[0]!.region = '경주';
      await expect(service.validate(OWNER, TRIP_ID, draft(result))).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(store.putCandidate).not.toHaveBeenCalled();
    },
  );

  it('detects edits made during candidate retrieval before publishing context', async () => {
    retrieval.retrieve.mockImplementation(async () => {
      savedItems[0]!.durationMin = 90;
      return { places: [] };
    });
    await expect(
      service.getContext(OWNER, TRIP_ID, { refreshCandidates: true }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(store.putSnapshot).not.toHaveBeenCalled();
  });

  it('rejects unknown lock and required IDs when capturing context', async () => {
    await expect(
      service.getContext(OWNER, TRIP_ID, { lockedItemIds: ['unknown'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.getContext(OWNER, TRIP_ID, { requiredItemIds: ['unknown'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('merges retrieved candidate day scope and preserves its server-owned metadata and preference score', async () => {
    days.push({
      id: 'day-2',
      tripId: TRIP_ID,
      day: 2,
      region: '경주',
      sortOrder: 0,
    } as TripDayEntity);
    retrieval.retrieve.mockResolvedValue({
      places: [
        {
          id: 'retrieved',
          category: 'cafe',
          name: '검색 장소',
          address: '부산',
          coordinates: { lat: 35.3, lng: 129 },
          openingHours: '00:00-24:00',
          crag: { personalization: 0.8, taste: 0.5 },
        },
      ],
    });
    const result = await service.getContext(OWNER, TRIP_ID, { refreshCandidates: true });
    const candidate = result.candidates.find(({ id }) => id === 'place:retrieved')!;
    expect(candidate.allowedDays).toEqual([1, 2]);
    expect(candidate.preferenceScore).toBe(0.8);
    expect(retrieval.retrieve).toHaveBeenCalledTimes(2);
    const evaluation = await service.evaluate(
      OWNER,
      TRIP_ID,
      draft(result, [
        {
          ...candidate.template,
          day: 2,
          scheduledAt: '2026-10-21T01:00:00.000Z',
        },
      ]),
    );
    expect(evaluation.valid).toBe(true);
    expect(evaluation.metrics.preferenceScore).toBe(0.8);
    expect(evaluation.items[0]!.coordinates).toEqual(candidate.template.coordinates);
  });

  it.each(['omit', 'modify'] as const)('protects user-locked items from %s', async (change) => {
    const result = await service.getContext(OWNER, TRIP_ID, { lockedItemIds: ['first'] });
    const inputs = structuredClone(result.items);
    if (change === 'omit') inputs.shift();
    else inputs[0]!.scheduledAt = at('10:00');
    await expect(service.validate(OWNER, TRIP_ID, draft(result, inputs))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('automatically protects already-started items and items that start after snapshot capture', async () => {
    trip.startDate = '2026-10-18';
    trip.endDate = '2026-10-19';
    savedItems[0]!.scheduledAt = new Date(NOW - 30 * 60_000);
    savedItems[0]!.durationMin = 90;
    savedItems[1]!.scheduledAt = new Date(NOW + 5 * 60_000);
    const result = await context();
    expect(result.lockedItemIds).toContain('first');
    expect(result.lockedItemIds).not.toContain('second');
    jest.setSystemTime(NOW + 6 * 60_000);
    await expect(
      service.validate(OWNER, TRIP_ID, draft(result, result.items.slice(0, 1))),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reports protected normalization as invalid and returns the original locked visit', async () => {
    savedItems[0]!.scheduledAt = new Date(at('06:00'));
    const result = await service.getContext(OWNER, TRIP_ID, { lockedItemIds: ['first'] });
    const evaluation = await service.evaluate(OWNER, TRIP_ID, draft(result));
    expect(evaluation.valid).toBe(false);
    expect(evaluation.violations).toContainEqual(
      expect.objectContaining({ code: 'LOCKED_ITEM_CHANGED', itemId: 'first' }),
    );
    expect(evaluation.items.find(({ id }) => id === 'first')).toEqual(result.items[0]);
  });

  it.each([
    ['unknown candidate', { id: 'unknown' }],
    ['name', { name: 'changed' }],
    ['coordinates', { coordinates: { lat: 0, lng: 0 } }],
    ['trip', { tripId: 'another-trip' }],
    ['day scope', { day: 2 }],
    ['invalid date', { scheduledAt: 'bad-date' }],
    ['duration', { durationMin: 0 }],
  ])('rejects forged candidate %s', async (_label, override) => {
    const result = await context();
    const items = result.items.map((entry, index) =>
      index === 0 ? { ...entry, ...override } : entry,
    );
    await expect(service.validate(OWNER, TRIP_ID, draft(result, items))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects repeated IDs and day/order slots', async () => {
    const result = await context();
    await expect(
      service.validate(OWNER, TRIP_ID, draft(result, [result.items[0]!, result.items[0]!])),
    ).rejects.toBeInstanceOf(BadRequestException);
    const items = structuredClone(result.items);
    items[1]!.order = 1;
    await expect(service.validate(OWNER, TRIP_ID, draft(result, items))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it.each(['owner', 'snapshot', 'version'] as const)(
    'denies a stored candidate with mismatched %s',
    async (kind) => {
      const result = await context();
      const evaluation = await service.evaluate(OWNER, TRIP_ID, draft(result));
      const stored = candidates.get(evaluation.candidateId)!;
      if (kind === 'owner') stored.ownerId = 'other-user';
      if (kind === 'snapshot') stored.snapshotId = 'other-snapshot';
      if (kind === 'version') stored.snapshotVersion = 'other-version';
      await expect(
        service.validate(OWNER, TRIP_ID, { ...draft(result), candidateId: evaluation.candidateId }),
      ).rejects.toBeInstanceOf(NotFoundException);
    },
  );

  it('re-evaluates a stored candidate only within the same owned snapshot', async () => {
    const result = await context();
    const first = await service.evaluate(OWNER, TRIP_ID, draft(result));
    const second = await service.evaluate(OWNER, TRIP_ID, {
      ...draft(result),
      candidateId: first.candidateId,
    });
    expect(second.items).toEqual(first.items);
    expect(second.candidateId).not.toBe(first.candidateId);
    await expect(
      service.evaluate(OWNER, TRIP_ID, {
        ...draft(result),
        items: result.items,
        candidateId: first.candidateId,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('distinguishes an empty candidate pool from failure to place available candidates', async () => {
    const populated = await context();
    const failed = await service.evaluate(OWNER, TRIP_ID, draft(populated, []));
    expect(failed.terminationReason).toBe('PLACEMENT_FAILED');
    savedItems = [];
    const empty = await context();
    const shortage = await service.evaluate(OWNER, TRIP_ID, draft(empty));
    expect(shortage.terminationReason).toBe('CANDIDATE_SHORTAGE');
  });

  it('reports required-item misses and target shortfall independently from dropped placements', async () => {
    const result = await service.getContext(OWNER, TRIP_ID, { requiredItemIds: ['first'] });
    const evaluation = await service.evaluate(OWNER, TRIP_ID, draft(result, result.items.slice(1)));
    expect(evaluation.metrics).toMatchObject({ pinMisses: 1, shortfall: 0 });
    expect(evaluation.metrics.targetShortfall).toBeGreaterThan(0);
    expect(evaluation.terminationReason).toBe('REQUIRED_ITEMS_MISSING');
    expect(evaluation.violations).toContainEqual(
      expect.objectContaining({ code: 'REQUIRED_ITEMS_MISSING' }),
    );
    expect(evaluation.valid).toBe(false);
  });

  it('preserves unknown opening-hour evidence rather than inventing a score or route provenance', async () => {
    delete savedItems[0]!.openingHours;
    const result = await context();
    const evaluation = await service.evaluate(OWNER, TRIP_ID, draft(result));
    expect(evaluation.unknownConstraints).toContainEqual(
      expect.objectContaining({ code: 'OPENING_HOURS_MISSING', itemId: 'first' }),
    );
    expect(evaluation.metrics.preferenceScore).toBeNull();
    expect(evaluation.routeEvidence).toBe('route-helper');
  });

  it('includes departure ETA and rejects a first visit before departure travel can finish', async () => {
    routes.getEta.mockImplementation(async (from: { lat: number }) => ({
      durationSec: (from.lat === 34 ? 120 : 20) * 60,
      distanceM: 2000,
    }));
    const result = await service.getContext(OWNER, TRIP_ID, { origin: { lat: 34, lng: 129 } });
    const evaluation = await service.evaluate(OWNER, TRIP_ID, draft(result));
    expect(evaluation.metrics.travelTimeMin).toBe(140);
    expect(evaluation.valid).toBe(false);
    expect(evaluation.violations).toContainEqual(
      expect.objectContaining({ code: 'INSUFFICIENT_ORIGIN_TRAVEL_TIME' }),
    );
  });

  it('bounds local-search evaluations and preserves saved state while improving a route', async () => {
    savedItems.push(
      entity(
        item({
          id: 'third',
          order: 3,
          scheduledAt: at('13:00'),
          coordinates: { lat: 35.3, lng: 129 },
        }),
      ),
    );
    routes.getEta.mockImplementation(async (from: { lat: number }, to: { lat: number }) => ({
      durationSec:
        ((from.lat === 35.1 && to.lat === 35.3) || (from.lat === 35.3 && to.lat === 35.2)
          ? 5
          : 20) * 60,
      distanceM: 2000,
    }));
    const result = await context();
    const original = structuredClone(savedItems);
    const optimized = await service.optimize(OWNER, TRIP_ID, {
      ...draft(result),
      maxEvaluations: 2,
      timeBudgetMs: 1000,
    });
    expect(optimized.evaluations).toBeLessThanOrEqual(2);
    expect(optimized.after.metrics.travelTimeMin).toBeLessThan(
      optimized.before.metrics.travelTimeMin!,
    );
    expect(optimized.items.map(({ id }) => id).sort()).toEqual(
      result.items.map(({ id }) => id).sort(),
    );
    expect(optimized.items.map(({ order }) => order)).toEqual([1, 2, 3]);
    expect(savedItems).toEqual(original);
    expect(store.release).toHaveBeenCalledWith(result.snapshotId, expect.any(String));
  });

  it('rejects duplicate optimization acquisition without releasing another owner lock', async () => {
    const result = await context();
    store.acquire.mockResolvedValueOnce(false);
    await expect(service.optimize(OWNER, TRIP_ID, draft(result))).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(store.release).not.toHaveBeenCalled();
  });

  it('releases its lock when the first evaluation fails', async () => {
    const result = await context();
    jest.spyOn(service, 'evaluatePrepared').mockRejectedValueOnce(new Error('provider failure'));
    await expect(service.optimize(OWNER, TRIP_ID, draft(result))).rejects.toThrow(
      'provider failure',
    );
    expect(store.release).toHaveBeenCalledTimes(1);
    expect(store.putCandidate).not.toHaveBeenCalled();
  });

  it('bounds an unresponsive first evaluation and releases the optimization lock', async () => {
    const result = await context();
    routes.getEta.mockImplementation(() => new Promise(() => undefined));
    await expect(
      service.optimize(OWNER, TRIP_ID, { ...draft(result), timeBudgetMs: 20 }),
    ).rejects.toBeInstanceOf(RequestTimeoutException);
    expect(store.release).toHaveBeenCalledTimes(1);
    expect(store.putCandidate).not.toHaveBeenCalled();
  });

  it('keeps the evaluated baseline when cancellation interrupts a later candidate', async () => {
    const result = await context();
    const controller = new AbortController();
    const evaluate = service.evaluatePrepared.bind(service);
    let count = 0;
    jest.spyOn(service, 'evaluatePrepared').mockImplementation(async (...args) => {
      const evaluated = await evaluate(...args);
      if (++count === 2) controller.abort();
      return evaluated;
    });
    const optimized = await service.optimize(OWNER, TRIP_ID, draft(result), controller.signal);
    expect(optimized.terminationReason).toBe('CANCELLED');
    expect(optimized.after.items).toEqual(optimized.before.items);
    expect(store.release).toHaveBeenCalledTimes(1);
  });
});

function item(overrides: Partial<ItineraryItemDto> = {}): ItineraryItemDto {
  return {
    id: 'first',
    tripId: TRIP_ID,
    day: 1,
    order: 1,
    type: 'cafe',
    name: '첫 장소',
    address: '부산',
    coordinates: { lat: 35.1, lng: 129 },
    scheduledAt: at('09:00'),
    durationMin: 60,
    openingHours: '00:00-24:00',
    ...overrides,
  };
}
function entity(dto: ItineraryItemDto): ItineraryItemEntity {
  return { ...dto, scheduledAt: new Date(dto.scheduledAt) } as ItineraryItemEntity;
}
function at(time: string): string {
  return new Date(`2026-10-20T${time}:00+09:00`).toISOString();
}
