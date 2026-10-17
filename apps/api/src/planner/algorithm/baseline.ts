import { haversineMeters } from '@tripick/utils';
import type { PlaceDto } from '@tripick/types';

type Coordinates = PlaceDto['coordinates'];

/** Only the day limits used by the existing draft builder, without services or persistence. */
export interface PlannedItemCountContext {
  planDays: readonly number[];
  itemsPerDay: number;
  anchorByDay: ReadonlyMap<number, { maxItems: number }>;
}

export interface LegacyDraftAttempt {
  validation: { valid: boolean };
  shortfall: number;
  pinMisses?: number;
}

export interface ComparableOptimizationMetrics {
  pinMisses: number;
  shortfall: number;
  targetShortfall: number;
  travelTimeMin: number;
  preferenceScore: number;
}

/**
 * Existing CRAG fallback ordering: choose a seed, then repeatedly visit the nearest candidate.
 * Equal distances preserve input ranking. The optional origin only changes seed ranking.
 * This deliberately does not normalize coordinates, fetch routes, or mutate the input array.
 */
export function orderByProximity<T extends { coordinates: Coordinates }>(
  candidates: readonly T[],
  attempt: number,
  origin?: Coordinates,
): T[] {
  if (candidates.length === 0) return [];

  const seedOrder = origin
    ? [...candidates].sort(
        (a, b) => haversineMeters(origin, a.coordinates) - haversineMeters(origin, b.coordinates),
      )
    : candidates;
  const remaining = [...candidates];
  const seed = seedOrder[attempt % seedOrder.length]!;
  const ordered: T[] = remaining.splice(remaining.indexOf(seed), 1);

  while (remaining.length > 0) {
    const from = ordered[ordered.length - 1]!.coordinates;
    let bestIndex = 0;
    let bestDistance = Infinity;
    remaining.forEach((candidate, index) => {
      const distance = haversineMeters(from, candidate.coordinates);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    ordered.push(...remaining.splice(bestIndex, 1));
  }
  return ordered;
}

/** Count the proposed visits after applying the same per-day slices as buildDraft. */
export function plannedItemCount(
  plan: readonly { day: number }[],
  context: PlannedItemCountContext,
): number {
  return context.planDays.reduce((sum, day) => {
    const target = context.anchorByDay.get(day)?.maxItems ?? context.itemsPerDay;
    const proposed = plan.filter((item) => item.day === day).length;
    return sum + Math.min(proposed, target);
  }, 0);
}

/** Proposal truncation and daily target shortage are intentionally separate metrics. */
export function draftShortfall(plannedCount: number, actualCount: number): number {
  return Math.max(0, plannedCount - actualCount);
}

export function isAcceptedDraft(valid: boolean, shortfall: number, pinMisses = 0): boolean {
  return valid && shortfall === 0 && pinMisses === 0;
}

/**
 * Preserve the time-anchor policy from integration base 01c71fd: only valid drafts qualify,
 * fewer missed time anchors wins, then smaller shortfall; the first tie stays.
 * Older pre-anchor fixtures omit pinMisses and therefore use zero. ETA belongs only
 * to compareOptimizationMetrics; extraction does not change the legacy tie policy.
 */
export function isBetterLegacyFallback(
  candidate: LegacyDraftAttempt,
  current: LegacyDraftAttempt | null,
): boolean {
  if (!candidate.validation.valid) return false;
  if (!current) return true;
  const pinDifference = (candidate.pinMisses ?? 0) - (current.pinMisses ?? 0);
  return pinDifference !== 0 ? pinDifference < 0 : candidate.shortfall < current.shortfall;
}

/** Count missing stable item IDs once, including when the requested IDs contain duplicates. */
export function countPinMisses(
  expectedIds: Iterable<string>,
  items: readonly { id: string }[],
): number {
  const actualIds = new Set(items.map((item) => item.id));
  return [...new Set(expectedIds)].filter((id) => !actualIds.has(id)).length;
}

/**
 * Negative means left is better. Hard validity, pins and truncation outrank travel time.
 * Target shortage and preference are reported independently, never used as hidden tie breakers.
 */
export function compareOptimizationMetrics(
  left: ComparableOptimizationMetrics,
  right: ComparableOptimizationMetrics,
  leftValid = true,
  rightValid = true,
): number {
  if (leftValid !== rightValid) return leftValid ? -1 : 1;
  return (
    left.pinMisses - right.pinMisses ||
    left.shortfall - right.shortfall ||
    left.travelTimeMin - right.travelTimeMin
  );
}
