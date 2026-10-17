/// <reference types="jest" />

import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import {
  PlanningContextDto,
  PlanningDraftDto,
  PlanningOptimizeDto,
} from '../../../src/planner/tools/planning.dto';

const snapshot = {
  snapshotId: 'd2b72d15-aae6-4784-a804-7db2f4d4d215',
  snapshotVersion: 'a'.repeat(64),
};
const visit = {
  id: 'first',
  day: 1,
  order: 1,
  scheduledAt: '2026-10-20T09:00:00+09:00',
  durationMin: 60,
};

describe('planning DTO validation', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  function parse(type: Type, value: unknown) {
    return pipe.transform(value, { type: 'body', metatype: type });
  }

  it('transforms valid nested placement data', async () => {
    const result = await parse(PlanningDraftDto, {
      ...snapshot,
      items: [{ ...visit, coordinates: { lat: 35, lng: 129 } }],
    });
    expect(result).toBeInstanceOf(PlanningDraftDto);
    expect(result.items[0].coordinates.lat).toBe(35);
  });

  it.each([
    { items: 'not-an-array' },
    { items: [null] },
    { items: [{ ...visit, day: 0 }] },
    { items: [{ ...visit, durationMin: 0 }] },
    { items: [{ ...visit, durationMin: 1441 }] },
    { items: [{ ...visit, scheduledAt: '2026-02-30T09:00:00+09:00' }] },
    { items: [{ ...visit, scheduledAt: 'bad-date' }] },
    { items: [{ ...visit, coordinates: [] }] },
    { items: [{ ...visit, coordinates: { lat: NaN, lng: 129 } }] },
    { items: [{ ...visit, coordinates: { lat: 91, lng: 129 } }] },
    { items: [{ ...visit, coordinates: { lat: 35, lng: Infinity } }] },
    { items: [{ ...visit, coordinates: { lat: 35 } }] },
    { items: [{ ...visit, serverOnlyScore: 1 }] },
    { items: Array.from({ length: 101 }, () => visit) },
    { snapshotId: 'invalid-uuid' },
    { snapshotVersion: 'a'.repeat(65) },
    { candidateId: 'invalid-uuid' },
    { ownerId: 'someone-else' },
  ])('rejects malformed or unsupported draft fields: %o', async (override) => {
    await expect(parse(PlanningDraftDto, { ...snapshot, ...override })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it.each([
    { origin: [] },
    { origin: { lat: 35 } },
    { origin: { lat: 35, lng: 181 } },
    { refreshCandidates: 'true' },
    { lockedItemIds: ['same', 'same'] },
    { requiredItemIds: [5] },
    { origin: { lat: 35, lng: 129, score: 1 } },
  ])('rejects malformed context options: %o', async (value) => {
    await expect(parse(PlanningContextDto, value)).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    { maxEvaluations: 0 },
    { maxEvaluations: 51 },
    { maxEvaluations: 1.5 },
    { timeBudgetMs: 0 },
    { timeBudgetMs: 2001 },
    { timeBudgetMs: NaN },
  ])('rejects optimization bounds outside the public contract: %o', async (override) => {
    await expect(parse(PlanningOptimizeDto, { ...snapshot, ...override })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
