/// <reference types="jest" />

import {
  compareOptimizationMetrics,
  countPinMisses,
  draftShortfall,
  isAcceptedDraft,
  isBetterLegacyFallback,
  orderByProximity,
  plannedItemCount,
  type ComparableOptimizationMetrics,
} from '../../../src/planner/algorithm/baseline';

// Golden input recorded from the planner policy at 7b50fbea052c1539efb82933c79e3c06a420af95.
const SCATTERED_CANDIDATES = [
  { id: 'haeundae-1', coordinates: { lat: 35.1587, lng: 129.1604 } },
  { id: 'geumjeong-1', coordinates: { lat: 35.26, lng: 128.99 } },
  { id: 'haeundae-2', coordinates: { lat: 35.1627, lng: 129.1624 } },
  { id: 'geumjeong-2', coordinates: { lat: 35.265, lng: 128.988 } },
  { id: 'haeundae-3', coordinates: { lat: 35.1557, lng: 129.1644 } },
  { id: 'geumjeong-3', coordinates: { lat: 35.256, lng: 128.993 } },
];

describe('extracted planner baseline', () => {
  it('replays the recorded nearest-neighbor route without changing candidate ranking', () => {
    const original = SCATTERED_CANDIDATES.map((item) => ({
      ...item,
      coordinates: { ...item.coordinates },
    }));

    expect(orderByProximity(SCATTERED_CANDIDATES, 0).map((item) => item.id)).toEqual([
      'haeundae-1',
      'haeundae-2',
      'haeundae-3',
      'geumjeong-3',
      'geumjeong-1',
      'geumjeong-2',
    ]);
    expect(SCATTERED_CANDIDATES).toEqual(original);
    expect(orderByProximity([], 0)).toEqual([]);
  });

  it('rotates the seed deterministically and chooses the seed nearest to an optional origin', () => {
    expect(orderByProximity(SCATTERED_CANDIDATES, 1)[0]).toBe(SCATTERED_CANDIDATES[1]);
    expect(orderByProximity(SCATTERED_CANDIDATES, 7)[0]).toBe(SCATTERED_CANDIDATES[1]);
    expect(orderByProximity(SCATTERED_CANDIDATES, 0, { lat: 35.265, lng: 128.988 })[0]).toBe(
      SCATTERED_CANDIDATES[3],
    );
  });

  it('preserves CRAG input order when seed and next-neighbor distances tie', () => {
    const candidates = ['top', 'second', 'third'].map((id) => ({
      id,
      coordinates: { lat: 35, lng: 129 },
    }));
    expect(orderByProximity(candidates, 0).map((item) => item.id)).toEqual([
      'top',
      'second',
      'third',
    ]);
    expect(orderByProximity(candidates, 1, { lat: 35, lng: 129 }).map((item) => item.id)).toEqual([
      'second',
      'top',
      'third',
    ]);
  });

  it('counts only requested days and applies current-day anchors before measuring truncation', () => {
    const context = {
      planDays: [1, 3],
      itemsPerDay: 5,
      anchorByDay: new Map([[1, { maxItems: 2 }]]),
    };
    const plan = [1, 1, 1, 2, 3].map((day) => ({ day }));
    const planned = plannedItemCount(plan, context);
    expect(planned).toBe(3);
    // The thin day-3 proposal is not counted as a truncation of the proposal.
    expect(draftShortfall(planned, 3)).toBe(0);
    expect(draftShortfall(planned, 2)).toBe(1);
    expect(draftShortfall(planned, 4)).toBe(0);
    expect(
      plannedItemCount(plan, { ...context, anchorByDay: new Map([[1, { maxItems: 0 }]]) }),
    ).toBe(1);
  });

  it('retains legacy acceptance, hard validity, and first-result tie behavior', () => {
    const attempt = (valid: boolean, shortfall: number) => ({ validation: { valid }, shortfall });
    expect(isAcceptedDraft(true, 0)).toBe(true);
    expect(isAcceptedDraft(false, 0)).toBe(false);
    expect(isAcceptedDraft(true, 1)).toBe(false);
    expect(isBetterLegacyFallback(attempt(false, 0), attempt(true, 2))).toBe(false);
    expect(isBetterLegacyFallback(attempt(true, 2), null)).toBe(true);
    expect(isBetterLegacyFallback(attempt(true, 1), attempt(true, 2))).toBe(true);
    expect(isBetterLegacyFallback(attempt(true, 2), attempt(true, 2))).toBe(false);
    expect(isBetterLegacyFallback(attempt(true, 3), attempt(true, 2))).toBe(false);
  });
});

describe('optimization-only metrics', () => {
  const metrics: ComparableOptimizationMetrics = {
    pinMisses: 0,
    shortfall: 0,
    targetShortfall: 0,
    travelTimeMin: 60,
    preferenceScore: 1,
  };

  it('counts missing pinned item IDs once', () => {
    expect(countPinMisses(['a', 'b', 'b'], [{ id: 'a' }, { id: 'c' }])).toBe(1);
    expect(countPinMisses([], [{ id: 'a' }])).toBe(0);
  });

  it('orders hard-valid results before pins, truncation, and travel time in that order', () => {
    expect(
      compareOptimizationMetrics(metrics, { ...metrics, travelTimeMin: 500 }, false, true),
    ).toBeGreaterThan(0);
    expect(
      compareOptimizationMetrics({ ...metrics, pinMisses: 1 }, { ...metrics, shortfall: 5 }),
    ).toBeGreaterThan(0);
    expect(
      compareOptimizationMetrics({ ...metrics, shortfall: 1 }, { ...metrics, travelTimeMin: 500 }),
    ).toBeGreaterThan(0);
    expect(compareOptimizationMetrics({ ...metrics, travelTimeMin: 30 }, metrics)).toBeLessThan(0);
  });

  it('reports target shortage and preference without silently adding comparison criteria', () => {
    expect(
      compareOptimizationMetrics(
        { ...metrics, targetShortfall: 10, preferenceScore: 0 },
        { ...metrics, targetShortfall: 0, preferenceScore: 10 },
      ),
    ).toBe(0);
  });
});

describe('published time-anchor baseline compatibility', () => {
  it('requires time anchors for acceptance and preserves pin priority over truncation', () => {
    expect(isAcceptedDraft(true, 0, 1)).toBe(false);
    expect(isAcceptedDraft(true, 0, 0)).toBe(true);
    expect(
      isBetterLegacyFallback(
        { validation: { valid: true }, shortfall: 2, pinMisses: 0 },
        { validation: { valid: true }, shortfall: 0, pinMisses: 1 },
      ),
    ).toBe(true);
    expect(
      isBetterLegacyFallback(
        { validation: { valid: true }, shortfall: 0, pinMisses: 1 },
        { validation: { valid: true }, shortfall: 2, pinMisses: 0 },
      ),
    ).toBe(false);
    expect(
      isBetterLegacyFallback(
        { validation: { valid: true }, shortfall: 1, pinMisses: 1 },
        { validation: { valid: true }, shortfall: 1, pinMisses: 1 },
      ),
    ).toBe(false);
  });
});
