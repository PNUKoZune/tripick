import type { ItineraryItemDto } from '@tripick/types';
import { orderByProximity } from '../../planner/algorithm/baseline';
import {
  PLANNING_ALGORITHM_VERSION,
  PLANNING_CONSTRAINT_VERSION,
  PLANNING_SCHEMA_VERSION,
  type PlanningSnapshot,
} from '../../planner/tools/planning.contract';

export type EvaluationSplit = 'development' | 'evaluation';
export type Scenario =
  | 'short'
  | 'multi-day'
  | 'overnight'
  | 'scattered'
  | 'few-candidates'
  | 'locked'
  | 'past'
  | 'opening-unknown'
  | 'opening-closed'
  | 'route-failure';

export interface PlanningEvaluationFixture {
  id: string;
  split: EvaluationSplit;
  scenario: Scenario;
  snapshot: PlanningSnapshot;
  /** Frozen directed intervisit ETA minutes, null represents an unavailable route. */
  etaMatrix: readonly (readonly (number | null)[])[];
  inputOrderIds: string[];
  baselineOrderIds: string[];
  /** Explicit fixture clock; past items are locked at snapshot creation, never inferred from wall time. */
  now: string;
}

// Fixed non-Euclidean travel network. Coordinates rank 0,1,2,... by proximity, while
// the transport network prefers 0,2,4,1,3,5. No network call or random seed is used.
const NETWORK: readonly (readonly number[])[] = Object.freeze([
  Object.freeze([0, 60, 10, 45, 25, 55, 30, 65]),
  Object.freeze([60, 0, 55, 10, 10, 35, 40, 20]),
  Object.freeze([10, 55, 0, 60, 10, 45, 20, 55]),
  Object.freeze([45, 10, 60, 0, 55, 10, 35, 15]),
  Object.freeze([25, 10, 10, 55, 0, 60, 15, 45]),
  Object.freeze([55, 35, 45, 10, 60, 0, 50, 20]),
  Object.freeze([30, 40, 20, 35, 15, 50, 0, 55]),
  Object.freeze([65, 20, 55, 15, 45, 20, 55, 0]),
]);

const SCENARIOS: Scenario[] = [
  'short',
  'multi-day',
  'overnight',
  'scattered',
  'few-candidates',
  'locked',
  'past',
  'opening-unknown',
  'opening-closed',
  'route-failure',
];

/** Twenty development cases and ten held-out cases. Held-out inputs never tune a search parameter. */
export function planningEvaluationFixtures(): PlanningEvaluationFixture[] {
  return [0, 1, 2].flatMap((variant) => SCENARIOS.map((scenario) => fixture(scenario, variant)));
}

function fixture(scenario: Scenario, variant: number): PlanningEvaluationFixture {
  const split: EvaluationSplit = variant === 2 ? 'evaluation' : 'development';
  const id = `${split}-${scenario}-${variant + 1}`;
  const overnight = scenario === 'overnight';
  const wakeTime = overnight ? '20:00' : '09:00';
  const sleepTime = overnight ? '04:00' : scenario === 'short' ? '14:00' : '22:00';
  const count =
    scenario === 'few-candidates' ? 2 : scenario === 'short' ? 3 : scenario === 'multi-day' ? 8 : 6;
  const items = Array.from(
    { length: count },
    (_, index): ItineraryItemDto => ({
      id: `${id}-item-${index}`,
      tripId: `trip-${id}`,
      day: scenario === 'multi-day' && index >= 4 ? 2 : 1,
      order: scenario === 'multi-day' ? index % 4 : index,
      type: index % 3 === 1 ? 'restaurant' : index % 3 === 2 ? 'cafe' : 'attraction',
      name: `${scenario} visit ${index}`,
      address: 'synthetic frozen fixture',
      coordinates: { lat: 37.5 + index * 0.001, lng: 127 + variant * 0.01 },
      scheduledAt: new Date(
        `2026-11-${scenario === 'multi-day' && index >= 4 ? '02' : '01'}T${wakeTime}:00+09:00`,
      ).toISOString(),
      durationMin: (overnight ? 50 : 35) + variant * 5,
      openingHours: overnight ? '20:00-04:00' : '00:00-24:00',
      travelTimeMin: 0,
      memo: `frozen-${variant}-${index}`,
    }),
  );
  if (scenario === 'opening-unknown') {
    delete items[1]!.openingHours;
    items[2]!.openingHours = 'by appointment';
  }
  if (scenario === 'opening-closed') items[1]!.openingHours = '00:00-01:00';

  const lockedItemIds =
    scenario === 'locked'
      ? [items[2]!.id]
      : scenario === 'past'
        ? items.slice(0, 2).map((item) => item.id)
        : [];
  // The baseline fixture order is computed through the extracted existing proximity
  // function inside lock-separated day segments. This is not a full PlannerService replay.
  const inputOrderIds = items.map((item) => item.id);
  const ordered: ItineraryItemDto[] = [];
  let segment: ItineraryItemDto[] = [];
  const flush = () => {
    ordered.push(...orderByProximity(segment, 0));
    segment = [];
  };
  for (const item of items) {
    if (lockedItemIds.includes(item.id) || (segment.length > 0 && segment[0]!.day !== item.day))
      flush();
    if (lockedItemIds.includes(item.id)) ordered.push(item);
    else segment.push(item);
  }
  flush();

  const etaMatrix = Object.freeze(
    NETWORK.slice(0, count).map((row, from) =>
      Object.freeze(
        row.slice(0, count).map((minutes, to): number | null => {
          if (scenario === 'route-failure' && from !== to) return null;
          if (scenario === 'scattered' && Math.abs(from - to) === 1) return 210 + variant * 5;
          return minutes + (from === to ? 0 : variant * 2);
        }),
      ),
    ),
  );
  // Freeze the initial timeline from this fixture's matrix, retaining every item.
  const dayEnd = new Map<number, number>();
  const previous = new Map<number, number>();
  ordered.forEach((item, index) => {
    const node = items.indexOf(item);
    const previousNode = previous.get(item.day);
    const travel = previousNode === undefined ? 0 : (etaMatrix[previousNode]![node] ?? 0);
    const dayStart = Date.parse(`2026-11-${item.day === 2 ? '02' : '01'}T${wakeTime}:00+09:00`);
    item.scheduledAt = new Date((dayEnd.get(item.day) ?? dayStart) + travel * 60_000).toISOString();
    item.order = scenario === 'multi-day' ? index % 4 : index;
    dayEnd.set(item.day, Date.parse(item.scheduledAt) + item.durationMin * 60_000);
    previous.set(item.day, node);
  });
  ordered.forEach((item, index) => {
    const next = ordered[index + 1];
    // DTO travelTimeMin describes this item's outgoing leg; scheduling above uses incoming ETA.
    const outgoing =
      next?.day === item.day ? etaMatrix[items.indexOf(item)]![items.indexOf(next)] : 0;
    if (outgoing === null || outgoing === undefined) delete item.travelTimeMin;
    else item.travelTimeMin = outgoing;
  });

  const now =
    scenario === 'past'
      ? new Date(Date.parse(items[1]!.scheduledAt) + items[1]!.durationMin * 60_000).toISOString()
      : '2026-10-18T00:00:00.000Z';
  const snapshot: PlanningSnapshot = {
    schemaVersion: PLANNING_SCHEMA_VERSION,
    algorithmVersion: PLANNING_ALGORITHM_VERSION,
    constraintVersion: PLANNING_CONSTRAINT_VERSION,
    snapshotId: `snapshot-${id}`,
    snapshotVersion: 'frozen-v1',
    ownerId: 'offline-evaluation',
    createdAt: now,
    expiresAt: '2026-12-01T00:00:00.000Z',
    trip: {
      id: `trip-${id}`,
      destination: 'synthetic transport network',
      startDate: '2026-11-01',
      endDate: scenario === 'multi-day' ? '2026-11-02' : '2026-11-01',
      wakeTime,
      sleepTime,
      transportMode: 'transit',
    },
    items: ordered,
    candidates: ordered.map((template, index) => ({
      id: template.id,
      template: structuredClone(template),
      allowedDays: [template.day],
      preferenceScore: Math.round((0.5 + ((index + variant) % 5) * 0.1) * 100) / 100,
    })),
    lockedItemIds,
    requiredItemIds: items.slice(0, 1).map((item) => item.id),
    dailyTargets:
      scenario === 'multi-day' ? { 1: 5, 2: 5 } : { 1: scenario === 'few-candidates' ? 5 : count },
  };
  return {
    id,
    split,
    scenario,
    snapshot,
    etaMatrix,
    inputOrderIds,
    baselineOrderIds: ordered.map((item) => item.id),
    now,
  };
}
