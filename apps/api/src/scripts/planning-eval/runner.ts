import { createHash } from 'node:crypto';
import type { ItineraryItemDto } from '@tripick/types';
import { countPinMisses, draftShortfall } from '../../planner/algorithm/baseline';
import { searchItinerary, type SearchEvaluation } from '../../planner/algorithm/local-search';
import { ConstraintEngine } from '../../planner/constraint/constraint.engine';
import { RouteHelper } from '../../planner/helpers/route.helper';
import { ScheduleConstraint } from '../../planner/helpers/schedule.constraint';
import type { PlanningIssue } from '../../planner/tools/planning.contract';
import type { EvaluationSplit, PlanningEvaluationFixture } from './fixtures';

export interface OfflineEvaluation extends SearchEvaluation {
  violations: PlanningIssue[];
  unknownConstraints: PlanningIssue[];
}

export interface EvaluationAdapter {
  evaluate(items: ItineraryItemDto[], signal?: AbortSignal): Promise<OfflineEvaluation>;
  routeCalls(): number;
}

export type AdapterFactory = (fixture: PlanningEvaluationFixture) => EvaluationAdapter;

export interface VariantResult {
  status: 'completed' | 'failed';
  valid: boolean;
  fullyConfirmed: boolean;
  lockedItemsPreserved: boolean;
  metrics: OfflineEvaluation['metrics'] | null;
  violations: string[];
  unknownConstraints: string[];
  evaluations: number;
  routeCalls: number;
  modelCalls: 0;
  durationMs: number;
  terminationReason: string;
  outputOrderIds: string[];
  error?: string;
}

export interface CaseResult {
  id: string;
  split: EvaluationSplit;
  scenario: string;
  fixtureSha256: string;
  snapshotId: string;
  snapshotVersion: string;
  hasLocks: boolean;
  inputOrderIds: string[];
  baselineOrderIds: string[];
  B: VariantResult;
  D: VariantResult;
}

/** Reusable runner: adapter failures become denominator entries rather than disappearing. */
export async function runPlanningEvaluation(
  fixtures: readonly PlanningEvaluationFixture[],
  options: { adapterFactory?: AdapterFactory; maxEvaluations?: number; timeBudgetMs?: number } = {},
) {
  const started = performance.now();
  const cases: CaseResult[] = [];
  for (const fixture of fixtures) {
    const variants = {} as Pick<CaseResult, 'B' | 'D'>;
    for (const variant of ['B', 'D'] as const) {
      const start = performance.now();
      let adapter: EvaluationAdapter | undefined;
      let evaluations = 0;
      try {
        adapter = (options.adapterFactory ?? frozenMatrixAdapter)(fixture);
        const evaluate = (items: ItineraryItemDto[], signal?: AbortSignal) => {
          evaluations += 1;
          return adapter!.evaluate(items, signal);
        };
        let evaluation: OfflineEvaluation;
        let terminationReason: string;
        if (variant === 'B') {
          evaluation = await evaluate(structuredClone(fixture.snapshot.items));
          terminationReason = 'BASELINE_VALIDATED';
        } else {
          const searched = await searchItinerary(structuredClone(fixture.snapshot.items), {
            evaluate,
            lockedItemIds: new Set(fixture.snapshot.lockedItemIds),
            maxEvaluations: options.maxEvaluations ?? 50,
            timeBudgetMs: options.timeBudgetMs ?? 2_000,
          });
          evaluation = searched.after;
          terminationReason = searched.terminationReason;
        }
        variants[variant] = {
          status: 'completed',
          valid: evaluation.valid,
          fullyConfirmed: evaluation.valid && evaluation.unknownConstraints.length === 0,
          lockedItemsPreserved: locksPreserved(fixture, evaluation.items),
          metrics: evaluation.metrics,
          violations: evaluation.violations.map((issue) => issue.code),
          unknownConstraints: evaluation.unknownConstraints.map((issue) => issue.code),
          evaluations,
          routeCalls: adapter.routeCalls(),
          modelCalls: 0,
          durationMs: performance.now() - start,
          terminationReason,
          outputOrderIds: evaluation.items.map((item) => item.id),
        };
      } catch (error) {
        variants[variant] = {
          status: 'failed',
          valid: false,
          fullyConfirmed: false,
          lockedItemsPreserved: false,
          metrics: null,
          violations: ['EVALUATION_FAILURE'],
          unknownConstraints: [],
          evaluations,
          routeCalls: adapter?.routeCalls() ?? 0,
          modelCalls: 0,
          durationMs: performance.now() - start,
          terminationReason: 'EVALUATION_FAILURE',
          outputOrderIds: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    cases.push({
      id: fixture.id,
      split: fixture.split,
      scenario: fixture.scenario,
      fixtureSha256: createHash('sha256').update(JSON.stringify(fixture)).digest('hex'),
      snapshotId: fixture.snapshot.snapshotId,
      snapshotVersion: fixture.snapshot.snapshotVersion,
      hasLocks: fixture.snapshot.lockedItemIds.length > 0,
      inputOrderIds: fixture.inputOrderIds,
      baselineOrderIds: fixture.baselineOrderIds,
      ...variants,
    });
  }
  return {
    schemaVersion: '1',
    fixtureVersion: 'synthetic-frozen-network-v1',
    baselineCommit: '7b50fbea052c1539efb82933c79e3c06a420af95',
    integrationBaseCommit: '01c71fd3bb77ecb01ae612771d626a2dd2e0b405',
    evidence: {
      kind: 'offline_synthetic',
      evaluator: 'ConstraintEngine + ScheduleConstraint + fixture-only reflow',
      routes: 'frozen directed ETA matrix; no live route or model calls',
      B: 'Extracted proximity ordering within unlocked same-day segments, fixture timeline validated and reflowed with the same evaluator as D; not a full legacy PlannerService replay.',
      D: 'Same initial visits, same evaluator, same-day bounded swap/insertion local search; no candidate replacement.',
      limitations: [
        'Synthetic frozen cases do not establish live model quality, production latency, real route accuracy, or user preference gains.',
        'Unknown opening hours are reported separately and never counted as fully confirmed constraints.',
        'Runtime durations vary; fixture inputs, metrics, and search order are deterministic unless the time budget expires.',
        'Development and evaluation cases share scenario templates; this is a fixed coverage split, not an independent real-world sample.',
        'Elapsed times are local harness measurements; financial cost is not measured. Live API and model calls are zero.',
        'Aggregate travelTimeMin includes invalid schedules when routes are known; valid-only ETA totals and their counts are reported separately.',
        'Item travelTimeMin is the outgoing leg. Locked metadata stays exactly as captured; aggregate ETA is recomputed from the frozen matrix rather than summed from stored item fields.',
      ],
    },
    modes: {
      A: {
        status: 'not_run',
        reason:
          'No captured pre-refactor full runtime snapshot with the required candidate, route, model and preference evidence.',
      },
      B: { status: 'completed' },
      C: {
        status: 'not_run',
        reason:
          'No captured live agent/tool/model execution. Offline search is not evidence of live tool orchestration.',
      },
      D: { status: 'completed' },
    },
    budget: {
      maxEvaluations: options.maxEvaluations ?? 50,
      timeBudgetMs: options.timeBudgetMs ?? 2_000,
    },
    totals: summarize(cases),
    splits: {
      development: summarize(cases.filter((entry) => entry.split === 'development')),
      evaluation: summarize(cases.filter((entry) => entry.split === 'evaluation')),
    },
    durationMs: performance.now() - started,
    cases,
  };
}

function summarize(cases: CaseResult[]) {
  const summarizeVariant = (variant: 'B' | 'D') => {
    const results = cases.map((entry) => entry[variant]);
    const denominator = results.length;
    const validCount = results.filter((result) => result.valid).length;
    const confirmedCount = results.filter((result) => result.fullyConfirmed).length;
    const failureCount = results.filter((result) => result.status === 'failed').length;
    const metrics = results.flatMap((result) => (result.metrics ? [result.metrics] : []));
    const eta = metrics.flatMap((metric) =>
      metric.travelTimeMin === null ? [] : [metric.travelTimeMin],
    );
    const preferences = metrics.flatMap((metric) =>
      metric.preferenceScore === null ? [] : [metric.preferenceScore],
    );
    const validEta = results.flatMap((result) =>
      result.valid &&
      result.metrics?.travelTimeMin !== null &&
      result.metrics?.travelTimeMin !== undefined
        ? [result.metrics.travelTimeMin]
        : [],
    );
    return {
      denominator,
      completedCount: denominator - failureCount,
      failureCount,
      validCount,
      validRate: denominator ? validCount / denominator : 0,
      fullyConfirmedCount: confirmedCount,
      fullyConfirmedRate: denominator ? confirmedCount / denominator : 0,
      unknownCaseCount: results.filter((result) => result.unknownConstraints.length > 0).length,
      lockedItemsPreservedCount: results.filter((result) => result.lockedItemsPreserved).length,
      casesWithLocks: cases.filter((entry) => entry.hasLocks).length,
      lockedCasePreservedCount: cases.filter(
        (entry) => entry.hasLocks && entry[variant].lockedItemsPreserved,
      ).length,
      metricAvailableCount: metrics.length,
      pinMisses: metrics.reduce((sum, metric) => sum + metric.pinMisses, 0),
      shortfall: metrics.reduce((sum, metric) => sum + metric.shortfall, 0),
      targetShortfall: metrics.reduce((sum, metric) => sum + metric.targetShortfall, 0),
      travelTimeMin: eta.reduce((sum, minutes) => sum + minutes, 0),
      travelTimeAvailableCount: eta.length,
      travelTimeValidOnlyMin: validEta.reduce((sum, minutes) => sum + minutes, 0),
      travelTimeValidAvailableCount: validEta.length,
      meanPreferenceScore: preferences.length
        ? preferences.reduce((sum, score) => sum + score, 0) / preferences.length
        : null,
      evaluations: results.reduce((sum, result) => sum + result.evaluations, 0),
      routeCalls: results.reduce((sum, result) => sum + result.routeCalls, 0),
      modelCalls: 0,
      durationMs: results.reduce((sum, result) => sum + result.durationMs, 0),
    };
  };
  const completedPairs = cases.filter(
    (entry) => entry.B.status === 'completed' && entry.D.status === 'completed',
  );
  const bothValid = completedPairs.filter((entry) => entry.B.valid && entry.D.valid);
  const matchedTravel = bothValid.filter(
    (entry) =>
      typeof entry.B.metrics?.travelTimeMin === 'number' &&
      Number.isFinite(entry.B.metrics.travelTimeMin) &&
      typeof entry.D.metrics?.travelTimeMin === 'number' &&
      Number.isFinite(entry.D.metrics.travelTimeMin),
  );
  return {
    B: summarizeVariant('B'),
    D: summarizeVariant('D'),
    comparison: {
      denominator: cases.length,
      completedPairCount: completedPairs.length,
      failedPairCount: cases.length - completedPairs.length,
      // Failed pairs are incomparable for validity transitions, and remain in the denominator.
      classificationIncomparableCount: cases.length - completedPairs.length,
      becameValid: completedPairs.filter((entry) => !entry.B.valid && entry.D.valid).length,
      becameInvalid: completedPairs.filter((entry) => entry.B.valid && !entry.D.valid).length,
      remainedInvalid: completedPairs.filter((entry) => !entry.B.valid && !entry.D.valid).length,
      bothValid: bothValid.length,
      matchedTravelPairCount: matchedTravel.length,
      travelIncomparableCount: cases.length - matchedTravel.length,
      unknownTravelBothValidCount: bothValid.length - matchedTravel.length,
      travelImproved: matchedTravel.filter(
        (entry) => entry.D.metrics!.travelTimeMin! < entry.B.metrics!.travelTimeMin!,
      ).length,
      travelEqual: matchedTravel.filter(
        (entry) => entry.D.metrics!.travelTimeMin === entry.B.metrics!.travelTimeMin,
      ).length,
      travelWorse: matchedTravel.filter(
        (entry) => entry.D.metrics!.travelTimeMin! > entry.B.metrics!.travelTimeMin!,
      ).length,
      matchedBeforeTravelMin: matchedTravel.reduce(
        (sum, entry) => sum + entry.B.metrics!.travelTimeMin!,
        0,
      ),
      matchedAfterTravelMin: matchedTravel.reduce(
        (sum, entry) => sum + entry.D.metrics!.travelTimeMin!,
        0,
      ),
    },
  };
}

/** Only routes against fixture data. This adapter does not instantiate Redis, Nest, or a DB. */
export function frozenMatrixAdapter(fixture: PlanningEvaluationFixture): EvaluationAdapter {
  const snapshot = fixture.snapshot;
  const nodeByCoordinates = new Map(
    snapshot.items.map((item) => [
      coordinateKey(item.coordinates),
      Number(item.id.split('-').at(-1)),
    ]),
  );
  let routeCallCount = 0;
  const eta = (from: ItineraryItemDto['coordinates'], to: ItineraryItemDto['coordinates']) => {
    routeCallCount += 1;
    const fromNode = nodeByCoordinates.get(coordinateKey(from));
    const toNode = nodeByCoordinates.get(coordinateKey(to));
    const minutes =
      fromNode === undefined || toNode === undefined
        ? undefined
        : fixture.etaMatrix[fromNode]?.[toNode];
    if (minutes === undefined || minutes === null) throw new Error('Frozen route unavailable');
    return { durationSec: minutes * 60, distanceM: minutes * 200 };
  };
  const routes = {
    getEta: async (from: ItineraryItemDto['coordinates'], to: ItineraryItemDto['coordinates']) =>
      eta(from, to),
  };
  const engine = new ConstraintEngine(routes as unknown as RouteHelper, new ScheduleConstraint());
  return {
    routeCalls: () => routeCallCount,
    async evaluate(proposed, signal) {
      const items = structuredClone(proposed);
      const dayCursor = new Map<number, number>();
      const previousByDay = new Map<number, ItineraryItemDto>();
      const locks = new Set(snapshot.lockedItemIds);
      const routeIssues: PlanningIssue[] = [];
      for (const item of items) {
        if (signal?.aborted) throw new Error('Offline evaluation aborted');
        const dayDate = new Date(`${snapshot.trip.startDate}T00:00:00+09:00`);
        dayDate.setUTCDate(dayDate.getUTCDate() + item.day - 1);
        const date = new Date(dayDate.getTime() + 9 * 60 * 60_000).toISOString().slice(0, 10);
        const dayStart = Date.parse(`${date}T${snapshot.trip.wakeTime}:00+09:00`);
        const previous = previousByDay.get(item.day);
        let travel = 0;
        let routeKnown = true;
        if (previous) {
          try {
            travel = eta(previous.coordinates, item.coordinates).durationSec / 60;
          } catch {
            routeKnown = false;
            routeIssues.push({
              code: 'ROUTE_UNAVAILABLE',
              message: 'Frozen reflow route unavailable',
              itemId: previous.id,
              relatedItemId: item.id,
            });
          }
        }
        if (!locks.has(item.id)) {
          item.scheduledAt = new Date(
            (dayCursor.get(item.day) ?? dayStart) + travel * 60_000,
          ).toISOString();
          item.travelTimeMin = 0;
          item.order = items.filter((candidate) => candidate.day === item.day).indexOf(item);
        }
        // Scheduling consumes the incoming ETA; the DTO stores it on the previous outgoing leg.
        // Locks retain their exact historical fields; fresh route metrics come from the engine.
        if (previous && !locks.has(previous.id)) {
          if (routeKnown) previous.travelTimeMin = travel;
          else delete previous.travelTimeMin;
        }
        dayCursor.set(item.day, Date.parse(item.scheduledAt) + item.durationMin * 60_000);
        previousByDay.set(item.day, item);
      }
      const validation = await engine.validate(items, {
        wakeTime: snapshot.trip.wakeTime,
        sleepTime: snapshot.trip.sleepTime,
        transportMode: snapshot.trip.transportMode,
        tripStartDate: snapshot.trip.startDate,
        ...(signal ? { signal } : {}),
        routeTimeoutMs: 100,
      });
      const lockValid = locksPreserved(fixture, validation.items);
      const violations: PlanningIssue[] = [...validation.violations, ...routeIssues];
      if (!lockValid)
        violations.push({
          code: 'LOCK_CHANGED',
          message: 'A locked item was changed, removed, or moved',
        });
      const pinMisses = countPinMisses(snapshot.requiredItemIds, validation.items);
      const byId = new Map(snapshot.candidates.map((candidate) => [candidate.id, candidate]));
      const scores = validation.items.flatMap((item) => {
        const score = byId.get(item.id)?.preferenceScore;
        return score === undefined || score === null ? [] : [score];
      });
      return {
        valid: validation.valid && routeIssues.length === 0 && lockValid && pinMisses === 0,
        // Normalization must never silently rewrite a locked item. The invalid result keeps input.
        items: structuredClone(lockValid ? validation.items : items),
        metrics: {
          pinMisses,
          shortfall: draftShortfall(snapshot.items.length, validation.items.length),
          targetShortfall: Object.entries(snapshot.dailyTargets).reduce(
            (sum, [day, target]) =>
              sum +
              Math.max(
                0,
                target - validation.items.filter((item) => item.day === Number(day)).length,
              ),
            0,
          ),
          travelTimeMin: validation.travelTimeMin,
          preferenceScore: scores.length
            ? scores.reduce((sum, score) => sum + score, 0) / scores.length
            : null,
        },
        violations,
        unknownConstraints: validation.unknownConstraints,
      };
    },
  };
}

function coordinateKey(coordinates: ItineraryItemDto['coordinates']): string {
  return `${coordinates.lat},${coordinates.lng}`;
}

function locksPreserved(fixture: PlanningEvaluationFixture, items: ItineraryItemDto[]): boolean {
  const originals = fixture.snapshot.items;
  return fixture.snapshot.lockedItemIds.every((id) => {
    const index = originals.findIndex((item) => item.id === id);
    // Fixture metadata is JSON data; value comparison also works across a test VM's clone realm.
    return index >= 0 && JSON.stringify(originals[index]) === JSON.stringify(items[index]);
  });
}
