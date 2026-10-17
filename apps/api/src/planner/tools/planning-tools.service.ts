import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  RequestTimeoutException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { ItineraryItemDto, ItineraryItemType } from '@tripick/types';
import { addDaysToIsoDate, countTripDays, getAwakeWindow } from '@tripick/utils';
import { TripEntity } from '../../trips/trip.entity';
import { TripDayEntity } from '../../trips/trip-day.entity';
import { ItineraryService } from '../../itinerary/itinerary.service';
import type { ItineraryItemEntity } from '../../itinerary/itinerary-item.entity';
import { PreferencesService } from '../../preferences/preferences.service';
import { GroupPreferenceService } from '../retrieval/group-preference.service';
import { PlaceRetrievalService } from '../retrieval/place-retrieval.service';
import { RouteHelper } from '../helpers/route.helper';
import { defaultVisitDuration, targetItemsPerDay } from '../helpers/itinerary-density';
import { ConstraintEngine } from '../constraint/constraint.engine';
import { countPinMisses } from '../algorithm/baseline';
import { searchItinerary, SearchDeadlineError } from '../algorithm/local-search';
import { withTimeout } from '../../common/with-timeout';
import { PlanningSnapshotStore } from './planning-snapshot.store';
import {
  PlanningContextDto,
  PlanningDraftDto,
  PlanningItemInputDto,
  PlanningOptimizeDto,
} from './planning.dto';
import {
  MAX_PLANNING_ITEMS,
  MAX_ROUTE_LOOKUPS,
  PLANNING_ALGORITHM_VERSION,
  PLANNING_CONSTRAINT_VERSION,
  PLANNING_SCHEMA_VERSION,
  SNAPSHOT_TTL_SECONDS,
  type PlanningCandidate,
  type PlanningEvaluation,
  type PlanningIssue,
  type PlanningSnapshot,
} from './planning.contract';

const ITEM_TYPES: readonly string[] = [
  'attraction',
  'restaurant',
  'cafe',
  'accommodation',
  'transport',
];

@Injectable()
export class PlanningToolsService {
  constructor(
    @InjectRepository(TripEntity) private readonly tripsRepo: Repository<TripEntity>,
    @InjectRepository(TripDayEntity) private readonly tripDaysRepo: Repository<TripDayEntity>,
    private readonly itinerary: ItineraryService,
    private readonly preferences: PreferencesService,
    private readonly groupPreferences: GroupPreferenceService,
    private readonly retrieval: PlaceRetrievalService,
    private readonly constraints: ConstraintEngine,
    private readonly routes: RouteHelper,
    private readonly store: PlanningSnapshotStore,
    private readonly config: ConfigService,
  ) {}

  async getContext(userId: string, tripId: string, dto: PlanningContextDto = {}) {
    this.assertEnabled();
    const state = await this.loadState(userId, tripId);
    const now = new Date();
    const dayCount = countTripDays(state.trip.startDate, state.trip.endDate);
    if (!Number.isInteger(dayCount) || dayCount < 1 || dayCount > 366) {
      throw new BadRequestException('Invalid trip date range');
    }
    if (state.items.length > MAX_PLANNING_ITEMS)
      throw new BadRequestException('Itinerary exceeds planning item limit');
    const [preference, group] = await Promise.all([
      this.preferences.findByUser(userId),
      this.groupPreferences.forTrip(tripId, userId),
    ]);
    const wakeTime = state.trip.wakeTime ?? '08:30';
    const sleepTime = state.trip.sleepTime ?? '22:00';
    const items = state.items.map(toItemDto);
    const allDays = Array.from({ length: dayCount }, (_, i) => i + 1);
    const candidates: PlanningCandidate[] = items.map((item) => ({
      id: item.id,
      template: item,
      preferenceScore: null,
      allowedDays: [item.day],
    }));
    const tasteTags = group?.tasteTags ?? preference?.tasteTags;
    if (dto.refreshCandidates || !items.length) {
      const regions = state.days.length
        ? state.days.map((day) => ({ destination: day.region, days: [day.day] }))
        : [{ destination: state.trip.destination, days: allDays }];
      // A bounded, sequential lookup keeps external fan-out independent of a model's arguments.
      const retrievalDeadline = performance.now() + 15_000;
      for (const region of regions.slice(0, 20)) {
        const remainingMs = Math.floor(retrievalDeadline - performance.now());
        if (remainingMs <= 0)
          throw new RequestTimeoutException('Planning candidate retrieval deadline exceeded');
        const retrieved = await withTimeout(
          this.retrieval.retrieve({
            userId,
            destination: region.destination,
            limit: Math.min(MAX_PLANNING_ITEMS, dayCount * 7 + 4),
            visitWindow: { from: state.trip.startDate, to: state.trip.endDate },
            startAt: new Date(
              `${addDaysToIsoDate(state.trip.startDate, region.days[0]! - 1)}T${wakeTime}:00+09:00`,
            ),
            ...(tasteTags ? { tasteTags } : {}),
            ...(group?.preferenceVector ? { preferenceVector: group.preferenceVector } : {}),
            ...(group?.memberPreferenceVectors
              ? { memberPreferenceVectors: group.memberPreferenceVectors }
              : {}),
          }),
          remainingMs,
          'Planning candidate retrieval timeout',
        );
        for (const place of retrieved.places) {
          const id = `place:${place.id}`;
          const existing = candidates.find((candidate) => candidate.id === id);
          if (existing) {
            existing.allowedDays = [...new Set([...existing.allowedDays, ...region.days])];
            continue;
          }
          if (candidates.length >= MAX_PLANNING_ITEMS * 2) break;
          const type: ItineraryItemType = ITEM_TYPES.includes(place.category)
            ? (place.category as ItineraryItemType)
            : 'attraction';
          const score = place.crag.personalization ?? place.crag.taste;
          candidates.push({
            id,
            preferenceScore: Number.isFinite(score) ? score : null,
            allowedDays: region.days,
            template: {
              id,
              tripId,
              day: region.days[0]!,
              order: 1,
              type,
              name: place.name,
              address: place.address,
              coordinates: { ...place.coordinates },
              durationMin: defaultVisitDuration(type),
              scheduledAt: new Date(
                `${addDaysToIsoDate(state.trip.startDate, region.days[0]! - 1)}T${wakeTime}:00+09:00`,
              ).toISOString(),
              ...(place.openingHours ? { openingHours: place.openingHours } : {}),
              ...(place.kakaoPlaceId ? { kakaoPlaceId: place.kakaoPlaceId } : {}),
              ...(place.phone ? { phoneNumber: place.phone } : {}),
              ...(place.imageUrl ? { imageUrl: place.imageUrl } : {}),
            },
          });
        }
      }
    }
    const known = new Set(candidates.map((candidate) => candidate.id));
    const itemIds = new Set(items.map((item) => item.id));
    if (
      (dto.lockedItemIds ?? []).some((id) => !itemIds.has(id)) ||
      (dto.requiredItemIds ?? []).some((id) => !known.has(id))
    ) {
      throw new BadRequestException(
        'Locks must reference saved items; required IDs must belong to this context',
      );
    }
    // All started/past visits are immutable, including a visit that is still in progress.
    const protectedIds = items
      .filter((item) => Date.parse(item.scheduledAt) <= now.getTime())
      .map((item) => item.id);
    const snapshot: PlanningSnapshot = {
      schemaVersion: PLANNING_SCHEMA_VERSION,
      algorithmVersion: PLANNING_ALGORITHM_VERSION,
      constraintVersion: PLANNING_CONSTRAINT_VERSION,
      snapshotId: randomUUID(),
      snapshotVersion: state.version,
      ownerId: userId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SNAPSHOT_TTL_SECONDS * 1000).toISOString(),
      trip: {
        id: tripId,
        destination: state.trip.destination,
        startDate: state.trip.startDate,
        endDate: state.trip.endDate,
        wakeTime,
        sleepTime,
        transportMode: state.trip.transportMode ?? 'transit',
      },
      items,
      candidates,
      lockedItemIds: [...new Set([...protectedIds, ...(dto.lockedItemIds ?? [])])],
      requiredItemIds: [...new Set(dto.requiredItemIds ?? [])],
      dailyTargets: Object.fromEntries(
        allDays.map((day) => [
          day,
          targetItemsPerDay(preference?.profile?.pace, wakeTime, sleepTime),
        ]),
      ),
      ...(dto.origin ? { origin: { ...dto.origin } } : {}),
    };
    // An edit during candidate retrieval invalidates the snapshot before it is published.
    await this.assertCurrent(userId, snapshot);
    await this.store.putSnapshot(snapshot);
    const { ownerId: _ownerId, ...context } = snapshot;
    void _ownerId;
    return {
      ...context,
      terminationReason: candidates.length ? 'CONTEXT_READY' : 'CANDIDATE_SHORTAGE',
    };
  }

  async validate(
    userId: string,
    tripId: string,
    dto: PlanningDraftDto,
  ): Promise<PlanningEvaluation> {
    this.assertEnabled();
    const snapshot = await this.loadSnapshot(userId, tripId, dto);
    const items = await this.resolveItems(userId, snapshot, dto);
    const evaluation = await this.evaluatePrepared(snapshot, items);
    await this.assertCurrent(userId, snapshot);
    await this.saveCandidate(snapshot, evaluation);
    return evaluation;
  }

  async evaluate(
    userId: string,
    tripId: string,
    dto: PlanningDraftDto,
  ): Promise<PlanningEvaluation> {
    return this.validate(userId, tripId, dto);
  }

  async optimize(userId: string, tripId: string, dto: PlanningOptimizeDto, signal?: AbortSignal) {
    this.assertEnabled();
    if (this.config.get<string>('PLANNING_LOCAL_SEARCH_ENABLED') !== 'true') {
      throw new NotFoundException('Planning local search is disabled');
    }
    const snapshot = await this.loadSnapshot(userId, tripId, dto);
    const initial = await this.resolveItems(userId, snapshot, dto);
    const lockToken = randomUUID();
    // Only one calculation per snapshot can run across all API instances.
    if (!(await this.store.acquire(snapshot.snapshotId, lockToken))) {
      throw new ConflictException('An optimization for this snapshot is already running');
    }
    try {
      const locked = this.lockedIds(snapshot);
      const initialOrder = initial.map((item) => item.id).join('\n');
      const routeCache = new Map<string, ReturnType<RouteHelper['getEta']>>();
      let routeLimitReached = false;
      let activeSignal: AbortSignal | undefined;
      const lookup: RouteHelper['getEta'] = (from, to, mode) => {
        if (activeSignal?.aborted)
          return Promise.reject(new Error('Planning route lookup cancelled'));
        const key = JSON.stringify([from.lat, from.lng, to.lat, to.lng, mode]);
        const cached = routeCache.get(key);
        if (cached) return cached;
        if (routeCache.size >= MAX_ROUTE_LOOKUPS) {
          routeLimitReached = true;
          return Promise.reject(new Error('Route lookup budget exhausted'));
        }
        const eta = this.routes.getEta(from, to, mode);
        routeCache.set(key, eta);
        return eta;
      };
      const result = await searchItinerary(initial, {
        lockedItemIds: locked,
        ...(dto.maxEvaluations !== undefined ? { maxEvaluations: dto.maxEvaluations } : {}),
        ...(dto.timeBudgetMs !== undefined ? { timeBudgetMs: dto.timeBudgetMs } : {}),
        ...(signal ? { signal } : {}),
        evaluate: async (candidate, searchSignal) => {
          activeSignal = searchSignal;
          const reordered = candidate.map((item) => item.id).join('\n') !== initialOrder;
          const reflowed = reordered
            ? await this.reflowPrepared(snapshot, candidate, searchSignal, lookup)
            : candidate;
          return this.evaluatePrepared(snapshot, reflowed, searchSignal, lookup);
        },
      });
      await this.assertCurrent(userId, snapshot);
      const final = {
        ...result.after,
        terminationReason: routeLimitReached ? 'ROUTE_LOOKUP_LIMIT' : result.terminationReason,
      };
      await this.saveCandidate(snapshot, final);
      return {
        ...final,
        before: result.before,
        after: final,
        evaluations: result.evaluations,
        elapsedMs: result.elapsedMs,
        routeLookups: routeCache.size,
        routeLookupLimit: MAX_ROUTE_LOOKUPS,
      };
    } catch (error) {
      if (error instanceof SearchDeadlineError) throw new RequestTimeoutException(error.message);
      throw error;
    } finally {
      await this.store.release(snapshot.snapshotId, lockToken);
    }
  }

  /** Computes feedback without database writes; direct API calls and MCP share this path. */
  async evaluatePrepared(
    snapshot: PlanningSnapshot,
    items: ItineraryItemDto[],
    signal?: AbortSignal,
    routeLookup?: RouteHelper['getEta'],
  ): Promise<PlanningEvaluation> {
    const violations = this.boundaryIssues(snapshot, items);
    const validation = await this.constraints.validate(items, {
      wakeTime: snapshot.trip.wakeTime,
      sleepTime: snapshot.trip.sleepTime,
      transportMode: snapshot.trip.transportMode,
      tripStartDate: snapshot.trip.startDate,
      routeTimeoutMs: 1500,
      ...(routeLookup ? { routeLookup } : {}),
      ...(signal ? { signal } : {}),
    });
    if (signal?.aborted) throw new SearchDeadlineError('CANCELLED');
    let normalized = validation.normalizedItems ?? validation.items;
    const locked = this.lockedIds(snapshot);
    for (const item of normalized) {
      if (
        locked.has(item.id) &&
        !sameItem(
          item,
          snapshot.items.find((saved) => saved.id === item.id),
        )
      ) {
        violations.push({
          code: 'LOCKED_ITEM_CHANGED',
          itemId: item.id,
          message: 'Normalization would change a protected item',
        });
      }
    }
    // A failed normalization must never expose a modified completed visit as the proposal.
    normalized = normalized.map((item) =>
      locked.has(item.id)
        ? structuredClone(snapshot.items.find((saved) => saved.id === item.id) ?? item)
        : item,
    );
    violations.push(
      ...(validation.violations ??
        validation.issues.map((message) => ({ code: 'CONSTRAINT_VIOLATION', message }))),
    );
    const byDay = Object.fromEntries(
      Object.entries(snapshot.dailyTargets).map(([day, target]) => [
        day,
        Math.max(0, target - normalized.filter((item) => item.day === Number(day)).length),
      ]),
    );
    const scores = normalized
      .map(
        (item) =>
          snapshot.candidates.find((candidate) => candidate.id === item.id)?.preferenceScore,
      )
      .filter((score): score is number => typeof score === 'number' && Number.isFinite(score));
    const pinMisses = countPinMisses(snapshot.requiredItemIds, normalized);
    if (pinMisses > 0)
      violations.push({
        code: 'REQUIRED_ITEMS_MISSING',
        message: `${pinMisses} required visits are missing`,
      });
    if (items.length === 0)
      violations.push({ code: 'NO_VISITS', message: 'No visits could be scheduled' });
    let travelTimeMin = validation.travelTimeMin ?? null;
    const unknownConstraints: PlanningIssue[] = [...(validation.unknownConstraints ?? [])];
    if (snapshot.origin && normalized.length) {
      const first = [...normalized].sort((a, b) => a.day - b.day || a.order - b.order)[0]!;
      if (!locked.has(first.id)) {
        try {
          const eta = await withTimeout(
            routeLookup
              ? routeLookup(snapshot.origin, first.coordinates, snapshot.trip.transportMode)
              : this.routes.getEta(snapshot.origin, first.coordinates, snapshot.trip.transportMode),
            1500,
            'Origin route deadline',
          );
          if (!Number.isFinite(eta.durationSec) || eta.durationSec < 0)
            throw new Error('Invalid origin ETA');
          const minutes = Math.ceil(eta.durationSec / 60);
          if (travelTimeMin !== null) travelTimeMin += minutes;
          const wakeAt = Date.parse(
            `${addDaysToIsoDate(snapshot.trip.startDate, first.day - 1)}T${snapshot.trip.wakeTime}:00+09:00`,
          );
          const earliestDeparture = Math.max(wakeAt, Date.now() + 10 * 60_000);
          if (Date.parse(first.scheduledAt) < earliestDeparture + minutes * 60_000) {
            violations.push({
              code: 'INSUFFICIENT_ORIGIN_TRAVEL_TIME',
              itemId: first.id,
              message: 'First visit starts before travel from the departure point can finish',
            });
          }
          if (minutes > 180)
            violations.push({
              code: 'EXCESSIVE_TRAVEL_TIME',
              itemId: first.id,
              message: 'Departure route exceeds 180 minutes',
            });
        } catch {
          travelTimeMin = null;
          const issue = {
            code: 'ROUTE_UNAVAILABLE',
            itemId: first.id,
            message: 'Departure route could not be validated',
          };
          violations.push(issue);
          unknownConstraints.push(issue);
        }
      }
    }
    const shortfall = Math.max(0, items.length - normalized.length);
    const targetShortfall = Object.values(byDay).reduce((sum, missing) => sum + missing, 0);
    const valid = validation.valid && violations.length === 0;
    return {
      schemaVersion: snapshot.schemaVersion,
      algorithmVersion: snapshot.algorithmVersion,
      constraintVersion: snapshot.constraintVersion,
      snapshotId: snapshot.snapshotId,
      snapshotVersion: snapshot.snapshotVersion,
      candidateId: randomUUID(),
      valid,
      // Invalid protected-item normalization is reported, never returned as an editable replacement.
      items: normalized,
      normalizedItems: normalized,
      normalizationChanges: validation.normalizationChanges ?? [],
      metrics: {
        pinMisses,
        shortfall,
        targetShortfall,
        travelTimeMin,
        preferenceScore: scores.length
          ? scores.reduce((sum, score) => sum + score, 0) / scores.length
          : null,
      },
      violations,
      unknownConstraints,
      terminationReason: !items.length
        ? snapshot.candidates.length
          ? 'PLACEMENT_FAILED'
          : 'CANDIDATE_SHORTAGE'
        : pinMisses
          ? 'REQUIRED_ITEMS_MISSING'
          : !valid
            ? 'CONSTRAINT_VIOLATION'
            : targetShortfall
              ? snapshot.candidates.length <
                Object.values(snapshot.dailyTargets).reduce((a, b) => a + b, 0)
                ? 'CANDIDATE_SHORTAGE'
                : 'TARGET_SHORTFALL'
              : 'VALIDATED',
      routeEvidence: 'route-helper',
    };
  }

  /** Recompute actual ETA and earliest start after a same-day reorder, preserving locked barriers. */
  async reflowPrepared(
    snapshot: PlanningSnapshot,
    items: ItineraryItemDto[],
    signal: AbortSignal,
    routeLookup?: RouteHelper['getEta'],
  ): Promise<ItineraryItemDto[]> {
    const locked = this.lockedIds(snapshot);
    const result = structuredClone(items);
    const firstDay = Math.min(...result.map((item) => item.day));
    for (const day of [...new Set(result.map((item) => item.day))]) {
      const today = result.filter((item) => item.day === day);
      const slots = today.map((item) => item.order).sort((a, b) => a - b);
      today.forEach((item, index) => {
        if (!locked.has(item.id)) item.order = slots[index]!;
      });
      const dayStart = Date.parse(
        `${addDaysToIsoDate(snapshot.trip.startDate, day - 1)}T${snapshot.trip.wakeTime}:00+09:00`,
      );
      const dayEnd =
        dayStart +
        getAwakeWindow(snapshot.trip.wakeTime, snapshot.trip.sleepTime).lengthMinutes * 60_000;
      let cursor = Math.max(dayStart, Date.now() + 10 * 60_000);
      // Future trips start at wake time. Past days consist of protected items only.
      if (dayStart > Date.now()) cursor = dayStart;
      let previous: ItineraryItemDto | undefined;
      for (const item of today) {
        if (signal.aborted) throw signal.reason ?? new Error('Planning cancelled');
        const origin =
          day === firstDay && !previous && !locked.has(item.id) ? snapshot.origin : undefined;
        if (previous || origin) {
          const from = previous?.coordinates ?? origin!;
          const eta = await withTimeout(
            routeLookup
              ? routeLookup(from, item.coordinates, snapshot.trip.transportMode)
              : this.routes.getEta(from, item.coordinates, snapshot.trip.transportMode),
            1500,
            'Route deadline',
          );
          if (!Number.isFinite(eta.durationSec) || eta.durationSec < 0)
            throw new Error('Invalid route ETA');
          const travelMin = Math.ceil(eta.durationSec / 60);
          cursor += travelMin * 60_000;
          if (previous && !locked.has(previous.id)) previous.travelTimeMin = travelMin;
        }
        if (!locked.has(item.id)) {
          cursor = earliestOpeningAt(item.openingHours, cursor, item.durationMin, dayStart, dayEnd);
          item.scheduledAt = new Date(cursor).toISOString();
        }
        cursor = Date.parse(item.scheduledAt) + item.durationMin * 60_000;
        previous = item;
      }
      const last = today[today.length - 1];
      if (last && !locked.has(last.id)) delete last.travelTimeMin;
    }
    return result;
  }

  private async resolveItems(
    userId: string,
    snapshot: PlanningSnapshot,
    dto: PlanningDraftDto,
  ): Promise<ItineraryItemDto[]> {
    if (dto.items !== undefined && dto.candidateId)
      throw new BadRequestException('Provide either items or candidateId');
    let inputs: PlanningItemInputDto[];
    if (dto.candidateId) {
      const stored = await this.store.getCandidate(dto.candidateId);
      if (
        !stored ||
        stored.ownerId !== userId ||
        stored.snapshotId !== snapshot.snapshotId ||
        stored.snapshotVersion !== snapshot.snapshotVersion
      ) {
        throw new NotFoundException('Planning candidate not found');
      }
      inputs = stored.evaluation.items;
    } else inputs = dto.items ?? snapshot.items;
    if (!Array.isArray(inputs) || inputs.length > MAX_PLANNING_ITEMS)
      throw new BadRequestException('Invalid planning item count');
    const result = inputs
      .map((input) => {
        const candidate = snapshot.candidates.find((item) => item.id === input.id);
        if (!candidate) throw new BadRequestException(`Unknown candidate ID: ${input.id}`);
        const template = candidate.template;
        for (const key of [
          'tripId',
          'name',
          'address',
          'type',
          'openingHours',
          'phoneNumber',
          'kakaoPlaceId',
          'imageUrl',
          'memo',
        ] as const) {
          if (input[key] !== undefined && input[key] !== template[key])
            throw new BadRequestException(`Candidate metadata mismatch: ${key}`);
        }
        if (
          input.coordinates &&
          (input.coordinates.lat !== template.coordinates.lat ||
            input.coordinates.lng !== template.coordinates.lng)
        ) {
          throw new BadRequestException('Candidate coordinates cannot be changed');
        }
        return {
          ...structuredClone(template),
          day: input.day,
          order: input.order,
          scheduledAt: input.scheduledAt,
          durationMin: input.durationMin,
          ...(input.travelTimeMin !== undefined ? { travelTimeMin: input.travelTimeMin } : {}),
        };
      })
      .sort((a, b) => a.day - b.day || a.order - b.order);
    const issues = this.boundaryIssues(snapshot, result);
    if (issues.length)
      throw new BadRequestException({ code: 'INVALID_PLANNING_DRAFT', violations: issues });
    return result;
  }

  private boundaryIssues(snapshot: PlanningSnapshot, items: ItineraryItemDto[]): PlanningIssue[] {
    const issues: PlanningIssue[] = [];
    const seen = new Set<string>();
    const slots = new Set<string>();
    const days = countTripDays(snapshot.trip.startDate, snapshot.trip.endDate);
    for (const item of items) {
      const candidate = snapshot.candidates.find((entry) => entry.id === item.id);
      if (seen.has(item.id) || slots.has(`${item.day}:${item.order}`))
        issues.push({
          code: 'DUPLICATE_ITEM',
          itemId: item.id,
          message: 'Duplicate item ID or day/order',
        });
      seen.add(item.id);
      slots.add(`${item.day}:${item.order}`);
      if (
        !candidate ||
        item.tripId !== snapshot.trip.id ||
        !Number.isInteger(item.day) ||
        item.day < 1 ||
        item.day > days ||
        !Number.isInteger(item.order) ||
        item.order < 1 ||
        !candidate.allowedDays.includes(item.day)
      ) {
        issues.push({
          code: 'TRIP_SCOPE',
          itemId: item.id,
          message: 'Candidate is outside its permitted trip/day scope',
        });
      }
      if (
        !Number.isFinite(Date.parse(item.scheduledAt)) ||
        !Number.isInteger(item.durationMin) ||
        item.durationMin < 1 ||
        item.durationMin > 1440
      ) {
        issues.push({
          code: 'INVALID_INPUT',
          itemId: item.id,
          message: 'Invalid date or visit duration',
        });
      }
    }
    for (const id of this.lockedIds(snapshot)) {
      if (
        !sameItem(
          items.find((item) => item.id === id),
          snapshot.items.find((item) => item.id === id),
        )
      ) {
        issues.push({
          code: 'LOCKED_ITEM_CHANGED',
          itemId: id,
          message: 'Started, past or user-locked items must remain unchanged',
        });
      }
    }
    return issues;
  }

  private lockedIds(snapshot: PlanningSnapshot): Set<string> {
    return new Set([
      ...snapshot.lockedItemIds,
      ...snapshot.items
        .filter((item) => Date.parse(item.scheduledAt) <= Date.now())
        .map((item) => item.id),
    ]);
  }

  private async loadSnapshot(
    userId: string,
    tripId: string,
    dto: PlanningDraftDto,
  ): Promise<PlanningSnapshot> {
    const snapshot = await this.store.getSnapshot(dto.snapshotId);
    if (
      !snapshot ||
      snapshot.ownerId !== userId ||
      snapshot.trip.id !== tripId ||
      Date.parse(snapshot.expiresAt) <= Date.now()
    ) {
      throw new NotFoundException('Planning snapshot not found or expired');
    }
    if (
      snapshot.snapshotVersion !== dto.snapshotVersion ||
      snapshot.constraintVersion !== PLANNING_CONSTRAINT_VERSION ||
      snapshot.schemaVersion !== PLANNING_SCHEMA_VERSION ||
      snapshot.algorithmVersion !== PLANNING_ALGORITHM_VERSION
    ) {
      throw new ConflictException('Planning snapshot version changed; retrieve context again');
    }
    await this.assertCurrent(userId, snapshot);
    return snapshot;
  }

  private async assertCurrent(userId: string, snapshot: PlanningSnapshot): Promise<void> {
    const current = await this.loadState(userId, snapshot.trip.id);
    if (current.version !== snapshot.snapshotVersion)
      throw new ConflictException('Itinerary changed; retrieve context and recalculate');
  }

  private async loadState(userId: string, tripId: string) {
    const trip = await this.tripsRepo.findOneBy({ id: tripId });
    if (!trip) throw new NotFoundException('Trip not found');
    if (trip.userId !== userId) throw new ForbiddenException();
    const [items, days] = await Promise.all([
      this.itinerary.findByTrip(tripId, userId),
      this.tripDaysRepo.find({
        where: { tripId },
        order: { day: 'ASC', sortOrder: 'ASC', id: 'ASC' },
      }),
    ]);
    const version = createHash('sha256')
      .update(
        JSON.stringify({ trip, days, items: [...items].sort((a, b) => a.id.localeCompare(b.id)) }),
      )
      .digest('hex');
    return { trip, items, days, version };
  }

  private async saveCandidate(
    snapshot: PlanningSnapshot,
    evaluation: PlanningEvaluation,
  ): Promise<void> {
    const seconds = Math.floor((Date.parse(snapshot.expiresAt) - Date.now()) / 1000);
    if (seconds <= 0) throw new ConflictException('Planning snapshot expired during calculation');
    await this.store.putCandidate(
      {
        ownerId: snapshot.ownerId,
        snapshotId: snapshot.snapshotId,
        snapshotVersion: snapshot.snapshotVersion,
        evaluation,
      },
      seconds,
    );
  }

  private assertEnabled(): void {
    if (this.config.get<string>('PLANNING_TOOLS_ENABLED') !== 'true')
      throw new NotFoundException('Planning tools are disabled');
  }
}

function sameItem(a: ItineraryItemDto | undefined, b: ItineraryItemDto | undefined): boolean {
  if (!a || !b) return false;
  return Object.keys({ ...a, ...b }).every((key) => {
    if (key === 'coordinates')
      return a.coordinates.lat === b.coordinates.lat && a.coordinates.lng === b.coordinates.lng;
    return a[key as keyof ItineraryItemDto] === b[key as keyof ItineraryItemDto];
  });
}

function toItemDto(entity: ItineraryItemEntity): ItineraryItemDto {
  const { id, tripId, day, order, type, name, address, coordinates, scheduledAt, durationMin } =
    entity;
  return {
    id,
    tripId,
    day,
    order,
    type,
    name,
    address,
    coordinates: { ...coordinates },
    scheduledAt: new Date(scheduledAt).toISOString(),
    durationMin,
    ...(entity.travelTimeMin != null ? { travelTimeMin: entity.travelTimeMin } : {}),
    ...(entity.openingHours != null ? { openingHours: entity.openingHours } : {}),
    ...(entity.phoneNumber != null ? { phoneNumber: entity.phoneNumber } : {}),
    ...(entity.kakaoPlaceId != null ? { kakaoPlaceId: entity.kakaoPlaceId } : {}),
    ...(entity.imageUrl != null ? { imageUrl: entity.imageUrl } : {}),
    ...(entity.memo != null ? { memo: entity.memo } : {}),
  };
}

/** Find an actual opening interval overlapping this awake window, including midnight. */
function earliestOpeningAt(
  hours: string | undefined,
  cursor: number,
  durationMin: number,
  dayStart: number,
  dayEnd: number,
): number {
  const match = hours?.match(/^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]|24):([0-5]\d)$/);
  if (!match || (match[3] === '24' && match[4] !== '00')) return cursor;
  const start = Number(match[1]) * 60 + Number(match[2]);
  let end = Number(match[3]) * 60 + Number(match[4]);
  if (end === start) return cursor;
  if (end < start) end += 1440;
  const midnight = Math.floor((dayStart + 9 * 3_600_000) / 86_400_000) * 86_400_000 - 9 * 3_600_000;
  for (const offset of [-1, 0, 1]) {
    const opensAt = midnight + offset * 86_400_000 + start * 60_000;
    const closesAt = midnight + offset * 86_400_000 + end * 60_000;
    const proposed = Math.max(cursor, dayStart, opensAt);
    if (proposed + durationMin * 60_000 <= Math.min(closesAt, dayEnd)) return proposed;
  }
  // Let validation report closed hours; never silently discard the visit.
  return cursor;
}
