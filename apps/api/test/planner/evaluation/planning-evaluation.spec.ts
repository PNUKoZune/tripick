/// <reference types="jest" />

import { Logger } from '@nestjs/common';
import { planningEvaluationFixtures } from '../../../src/scripts/planning-eval/fixtures';
import {
  frozenMatrixAdapter,
  runPlanningEvaluation,
} from '../../../src/scripts/planning-eval/runner';

describe('offline planning evaluation', () => {
  beforeAll(() => {
    Logger.overrideLogger(['error']);
  });

  it('freezes 30 deterministic cases into a 20/10 coverage split', () => {
    const fixtures = planningEvaluationFixtures();
    expect(fixtures).toHaveLength(30);
    expect(fixtures.filter((fixture) => fixture.split === 'development')).toHaveLength(20);
    expect(fixtures.filter((fixture) => fixture.split === 'evaluation')).toHaveLength(10);
    expect(new Set(fixtures.map((fixture) => fixture.scenario)).size).toBe(10);
    expect(planningEvaluationFixtures()).toEqual(fixtures);
    expect(Object.isFrozen(fixtures[0]!.etaMatrix)).toBe(true);
    expect(Object.isFrozen(fixtures[0]!.etaMatrix[0])).toBe(true);
  });

  it('keeps every failed run in the denominator when an evaluator throws', async () => {
    const report = await runPlanningEvaluation(planningEvaluationFixtures().slice(0, 1), {
      adapterFactory: () => ({
        routeCalls: () => 0,
        evaluate: async () => {
          throw new Error('deliberate fixture adapter failure');
        },
      }),
    });
    for (const mode of ['B', 'D'] as const) {
      expect(report.totals[mode]).toMatchObject({
        denominator: 1,
        failureCount: 1,
        validRate: 0,
        metricAvailableCount: 0,
      });
      expect(report.cases[0]![mode]).toMatchObject({
        status: 'failed',
        evaluations: 1,
        terminationReason: 'EVALUATION_FAILURE',
      });
    }
    expect(report.modes.A.status).toBe('not_run');
    expect(report.modes.C.status).toBe('not_run');
    expect(report.totals.comparison).toMatchObject({
      denominator: 1,
      completedPairCount: 0,
      failedPairCount: 1,
      classificationIncomparableCount: 1,
      travelIncomparableCount: 1,
      becameValid: 0,
      becameInvalid: 0,
      remainedInvalid: 0,
      bothValid: 0,
      matchedTravelPairCount: 0,
      matchedBeforeTravelMin: 0,
      matchedAfterTravelMin: 0,
    });
  });

  it('separates unknown opening evidence from validity and rejects unavailable frozen routes', async () => {
    const fixtures = planningEvaluationFixtures();
    const unknown = fixtures.find((fixture) => fixture.scenario === 'opening-unknown')!;
    const unknownResult = await frozenMatrixAdapter(unknown).evaluate(unknown.snapshot.items);
    expect(unknownResult.valid).toBe(true);
    expect(unknownResult.unknownConstraints.map((issue) => issue.code)).toEqual([
      'OPENING_HOURS_MISSING',
      'OPENING_HOURS_UNPARSEABLE',
    ]);
    expect(unknownResult.items[0]!.travelTimeMin).toBe(unknown.etaMatrix[0]![1]);
    expect(unknownResult.items.at(-1)!.travelTimeMin).toBe(0);
    const failedRoute = fixtures.find((fixture) => fixture.scenario === 'route-failure')!;
    const failedResult = await frozenMatrixAdapter(failedRoute).evaluate(
      failedRoute.snapshot.items,
    );
    expect(failedResult.valid).toBe(false);
    expect(failedResult.metrics.travelTimeMin).toBeNull();
    expect(failedResult.violations.some((issue) => issue.code === 'ROUTE_UNAVAILABLE')).toBe(true);
  });

  it('runs real constraints and bounded search without changing any locked or past visit', async () => {
    const fixtures = planningEvaluationFixtures();
    const report = await runPlanningEvaluation(fixtures);
    expect(report.cases).toHaveLength(30);
    for (const mode of ['B', 'D'] as const) {
      expect(report.totals[mode]).toMatchObject({
        denominator: 30,
        failureCount: 0,
        lockedItemsPreservedCount: 30,
        pinMisses: 0,
        shortfall: 0,
        modelCalls: 0,
      });
      expect(report.totals[mode].fullyConfirmedCount).toBeLessThan(report.totals[mode].validCount);
    }
    expect(report.splits.evaluation.B.denominator).toBe(10);
    expect(report.splits.development.D.denominator).toBe(20);
    const comparison = report.totals.comparison;
    expect(comparison.denominator).toBe(30);
    expect(
      comparison.becameValid +
        comparison.becameInvalid +
        comparison.remainedInvalid +
        comparison.bothValid +
        comparison.classificationIncomparableCount,
    ).toBe(30);
    expect(comparison.matchedTravelPairCount + comparison.travelIncomparableCount).toBe(30);
    expect(comparison.travelImproved + comparison.travelEqual + comparison.travelWorse).toBe(
      comparison.matchedTravelPairCount,
    );
    expect(comparison).toMatchObject({
      failedPairCount: 0,
      becameInvalid: 0,
      remainedInvalid: 6,
      bothValid: 18,
      becameValid: 6,
      matchedTravelPairCount: 18,
      travelWorse: 0,
    });
    expect(comparison.matchedAfterTravelMin).toBeLessThanOrEqual(comparison.matchedBeforeTravelMin);
    for (const entry of report.cases) {
      expect(entry.D.evaluations).toBeLessThanOrEqual(50);
      expect(entry.D.outputOrderIds).toHaveLength(entry.baselineOrderIds.length);
      expect(entry.D.metrics!.targetShortfall).toBe(entry.B.metrics!.targetShortfall);
      if (entry.B.valid) expect(entry.D.valid).toBe(true);
      if (entry.B.valid && entry.B.metrics!.travelTimeMin !== null) {
        expect(entry.D.metrics!.travelTimeMin).toBeLessThanOrEqual(entry.B.metrics!.travelTimeMin!);
      }
    }
    expect(
      report.cases.some(
        (entry) => entry.D.metrics!.travelTimeMin! < entry.B.metrics!.travelTimeMin!,
      ),
    ).toBe(true);
  });
});
