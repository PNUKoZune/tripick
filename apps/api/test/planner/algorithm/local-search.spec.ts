/// <reference types="jest" />

import type { ItineraryItemDto } from '@tripick/types';
import {
  SearchDeadlineError,
  searchItinerary,
  type SearchEvaluation,
  type SearchMetrics,
} from '../../../src/planner/algorithm/local-search';

const metrics = (changes: Partial<SearchMetrics> = {}): SearchMetrics => ({
  pinMisses: 0,
  shortfall: 0,
  targetShortfall: 0,
  travelTimeMin: 100,
  preferenceScore: null,
  ...changes,
});

function visit(id: string, day = 1): ItineraryItemDto {
  return {
    id,
    tripId: 'trip',
    day,
    order: 0,
    type: 'attraction',
    name: `Place ${id}`,
    address: `Address ${id}`,
    coordinates: { lat: 37, lng: 127 },
    scheduledAt: '2026-10-20T09:00:00+09:00',
    durationMin: 60,
    memo: `memo-${id}`,
  };
}

function evaluateWith(
  score: (items: ItineraryItemDto[]) => Partial<SearchMetrics>,
  valid: (items: ItineraryItemDto[]) => boolean = () => true,
): (items: ItineraryItemDto[], signal: AbortSignal) => Promise<SearchEvaluation> {
  return async (items) => ({ items, valid: valid(items), metrics: metrics(score(items)) });
}

const ids = (items: ItineraryItemDto[]): string => items.map((item) => item.id).join('');

describe('searchItinerary', () => {
  it('uses actual evaluated travel time to improve the order', async () => {
    const result = await searchItinerary([visit('a'), visit('b'), visit('c')], {
      lockedItemIds: new Set(),
      evaluate: evaluateWith((items) => ({ travelTimeMin: ids(items) === 'bac' ? 20 : 100 })),
    });

    expect(ids(result.items)).toBe('bac');
    expect(result.before.metrics.travelTimeMin).toBe(100);
    expect(result.after.metrics.travelTimeMin).toBe(20);
    expect(result.terminationReason).toBe('LOCAL_OPTIMUM');
  });

  it('explores insertion moves that cannot be reached by one improving swap', async () => {
    const result = await searchItinerary(
      ['a', 'b', 'c', 'd'].map((id) => visit(id)),
      {
        lockedItemIds: new Set(),
        evaluate: evaluateWith((items) => ({ travelTimeMin: ids(items) === 'bcad' ? 10 : 100 })),
      },
    );

    expect(ids(result.items)).toBe('bcad');
    expect(result.after.metrics.travelTimeMin).toBe(10);
  });

  it('prioritizes pinned visits, then minimum shortfall, ahead of travel time', async () => {
    const result = await searchItinerary(
      ['a', 'b', 'c'].map((id) => visit(id)),
      {
        lockedItemIds: new Set(),
        evaluate: evaluateWith((items) => {
          const key = ids(items);
          if (key === 'abc') return { pinMisses: 1, shortfall: 0, travelTimeMin: 1 };
          if (key === 'bac') return { pinMisses: 0, shortfall: 1, travelTimeMin: 50 };
          if (key === 'bca') return { pinMisses: 0, shortfall: 0, travelTimeMin: 200 };
          return { pinMisses: 2, shortfall: 0, travelTimeMin: 0 };
        }),
      },
    );

    expect(ids(result.items)).toBe('bca');
    expect(result.after.metrics.pinMisses).toBe(0);
    expect(result.after.metrics.shortfall).toBe(0);
  });

  it('rejects a faster candidate that fails constraints', async () => {
    const result = await searchItinerary([visit('a'), visit('b')], {
      lockedItemIds: new Set(),
      evaluate: evaluateWith(
        (items) => ({ travelTimeMin: ids(items) === 'ba' ? 1 : 100 }),
        (items) => ids(items) === 'ab',
      ),
    });

    expect(ids(result.items)).toBe('ab');
    expect(result.after.valid).toBe(true);
  });

  it('accepts a valid candidate ahead of an invalid baseline with a better metric', async () => {
    const result = await searchItinerary([visit('a'), visit('b')], {
      lockedItemIds: new Set(),
      evaluate: evaluateWith(
        (items) => ({ travelTimeMin: ids(items) === 'ba' ? 100 : 1 }),
        (items) => ids(items) === 'ba',
      ),
    });

    expect(ids(result.items)).toBe('ba');
    expect(result.before.valid).toBe(false);
    expect(result.after.valid).toBe(true);
  });

  it('preserves locks exactly, never crosses their barriers or days, and does not mutate input', async () => {
    const input = [
      visit('a'),
      visit('b'),
      visit('lock'),
      visit('c'),
      visit('d'),
      visit('e', 2),
      visit('f', 2),
    ];
    input[2]!.type = 'accommodation';
    input[2]!.order = 2;
    input[2]!.scheduledAt = '2026-10-20T12:00:00+09:00';
    const original = structuredClone(input);
    const seen: ItineraryItemDto[][] = [];
    const result = await searchItinerary(input, {
      lockedItemIds: new Set(['lock']),
      evaluate: async (items) => {
        seen.push(structuredClone(items));
        const travelTimeMin =
          (items[0]!.id === 'b' ? 0 : 10) +
          (items[3]!.id === 'd' ? 0 : 10) +
          (items[5]!.id === 'f' ? 0 : 10);
        // The evaluator may reflow mutable visit time/order, but cannot change a lock.
        items.forEach((item, index) => {
          if (item.id !== 'lock') {
            item.order = index;
            item.scheduledAt = `2026-10-20T${index + 10}:00:00+09:00`;
          }
        });
        return { items, valid: true, metrics: metrics({ travelTimeMin }) };
      },
    });

    expect(input).toEqual(original);
    expect(ids(result.items)).toBe('balockdcfe');
    expect(result.items[2]).toEqual(original[2]);
    for (const candidate of seen) {
      expect(new Set(candidate.slice(0, 2).map((item) => item.id))).toEqual(new Set(['a', 'b']));
      expect(candidate[2]).toEqual(original[2]);
      expect(new Set(candidate.slice(3, 5).map((item) => item.id))).toEqual(new Set(['c', 'd']));
      expect(candidate.slice(5).every((item) => item.day === 2)).toBe(true);
    }
  });

  it('rejects evaluator mutation of locks and metadata without exposing it in the result', async () => {
    const input = [visit('a'), visit('b'), visit('lock')];
    const original = structuredClone(input);
    const result = await searchItinerary(input, {
      lockedItemIds: new Set(['lock']),
      evaluate: async (items) => {
        if (ids(items) === 'balock') {
          items[0]!.memo = 'changed metadata';
          items[2]!.coordinates.lat = 0;
        }
        return {
          items,
          valid: true,
          metrics: metrics({ travelTimeMin: ids(items) === 'balock' ? 0 : 100 }),
        };
      },
    });

    expect(result.items).toEqual(original);
    expect(input).toEqual(original);
  });

  it('compares JSON DTO values across clone and evaluator object prototypes', async () => {
    const input = [visit('a'), visit('b'), visit('lock')];
    const result = await searchItinerary(input, {
      lockedItemIds: new Set(['lock']),
      evaluate: async (items) => ({
        valid: true,
        items: items.map((item) => ({ ...item, coordinates: { ...item.coordinates } })),
        metrics: metrics({ travelTimeMin: ids(items) === 'balock' ? 1 : 100 }),
      }),
    });

    expect(result.before.valid).toBe(true);
    expect(result.after.valid).toBe(true);
    expect(ids(result.items)).toBe('balock');
    expect(result.items[2]).toEqual(input[2]);
  });

  it('keeps ties stable and does not optimize target or preference metrics', async () => {
    const result = await searchItinerary([visit('a'), visit('b')], {
      lockedItemIds: new Set(),
      evaluate: evaluateWith((items) =>
        ids(items) === 'ab'
          ? { targetShortfall: 100, preferenceScore: 0 }
          : { targetShortfall: 0, preferenceScore: 1 },
      ),
    });

    expect(ids(result.items)).toBe('ab');
  });

  it('does not use unknown ETA to beat a known ETA', async () => {
    const result = await searchItinerary([visit('a'), visit('b')], {
      lockedItemIds: new Set(),
      evaluate: evaluateWith((items) => ({ travelTimeMin: ids(items) === 'ab' ? 100 : null })),
    });

    expect(ids(result.items)).toBe('ab');
  });

  it('caps all evaluation attempts, including the baseline, at 50', async () => {
    let evaluations = 0;
    const result = await searchItinerary(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => visit(id)),
      {
        maxEvaluations: 1_000,
        lockedItemIds: new Set(),
        evaluate: async (items) => ({
          items,
          valid: true,
          metrics: metrics({ travelTimeMin: 1_000 - ++evaluations }),
        }),
      },
    );

    expect(evaluations).toBe(50);
    expect(result.evaluations).toBe(50);
    expect(result.terminationReason).toBe('EVALUATION_LIMIT');
    expect(result.after.metrics.travelTimeMin).toBe(950);
  });

  it('honors a smaller evaluation limit', async () => {
    const evaluator = jest.fn(evaluateWith(() => ({})));
    const result = await searchItinerary([visit('a'), visit('b')], {
      maxEvaluations: 1,
      lockedItemIds: new Set(),
      evaluate: evaluator,
    });

    expect(evaluator).toHaveBeenCalledTimes(1);
    expect(result.terminationReason).toBe('EVALUATION_LIMIT');
  });

  it('returns the last evaluated valid best when an ETA call ignores cancellation', async () => {
    let calls = 0;
    let pendingSignal: AbortSignal | undefined;
    const result = await searchItinerary([visit('a'), visit('b'), visit('c')], {
      timeBudgetMs: 20,
      lockedItemIds: new Set(),
      evaluate: async (items, signal) => {
        calls += 1;
        if (calls <= 2)
          return { items, valid: true, metrics: metrics({ travelTimeMin: 100 / calls }) };
        pendingSignal = signal;
        return new Promise<SearchEvaluation>(() => undefined);
      },
    });

    expect(result.terminationReason).toBe('TIME_LIMIT');
    expect(result.after.metrics.travelTimeMin).toBe(50);
    expect(ids(result.items)).toBe('bac');
    expect(pendingSignal?.aborted).toBe(true);
  });

  it('clamps the time budget to 2 seconds even when the requested budget is larger', async () => {
    let time = 0;
    const result = await searchItinerary([visit('a'), visit('b')], {
      timeBudgetMs: 50_000,
      now: () => time,
      lockedItemIds: new Set(),
      evaluate: async (items) => {
        time += 1_000;
        return { items, valid: true, metrics: metrics({ travelTimeMin: 2_000 - time }) };
      },
    });

    expect(result.terminationReason).toBe('TIME_LIMIT');
    expect(result.evaluations).toBe(2);
    expect(ids(result.items)).toBe('ab');
    expect(result.elapsedMs).toBe(2_000);
  });

  it('returns the evaluated baseline on cancellation during a candidate call', async () => {
    const controller = new AbortController();
    let calls = 0;
    const result = await searchItinerary([visit('a'), visit('b')], {
      signal: controller.signal,
      lockedItemIds: new Set(),
      evaluate: async (items) => {
        calls += 1;
        if (calls === 1) return { items, valid: true, metrics: metrics() };
        controller.abort();
        return new Promise<SearchEvaluation>(() => undefined);
      },
    });

    expect(result.terminationReason).toBe('CANCELLED');
    expect(result.after.valid).toBe(true);
    expect(ids(result.items)).toBe('ab');
  });

  it('reports cancellation before a baseline without invoking the evaluator', async () => {
    const controller = new AbortController();
    controller.abort();
    const evaluator = jest.fn(evaluateWith(() => ({})));

    await expect(
      searchItinerary([visit('a')], {
        signal: controller.signal,
        lockedItemIds: new Set(),
        evaluate: evaluator,
      }),
    ).rejects.toMatchObject({ name: 'SearchDeadlineError', reason: 'CANCELLED' });
    expect(evaluator).not.toHaveBeenCalled();
  });

  it('throws a typed deadline error when baseline evaluation cannot complete', async () => {
    await expect(
      searchItinerary([visit('a')], {
        timeBudgetMs: 5,
        lockedItemIds: new Set(),
        evaluate: async () => new Promise<SearchEvaluation>(() => undefined),
      }),
    ).rejects.toBeInstanceOf(SearchDeadlineError);
  });

  it('keeps the typed deadline when a provider rejects in response to abort', async () => {
    await expect(
      searchItinerary([visit('a')], {
        timeBudgetMs: 5,
        lockedItemIds: new Set(),
        evaluate: async (_items, signal) =>
          new Promise<SearchEvaluation>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('provider aborted')));
          }),
      }),
    ).rejects.toMatchObject({ name: 'SearchDeadlineError', reason: 'TIME_LIMIT' });
  });

  it('observes provider rejections that arrive after the deadline', async () => {
    let calls = 0;
    const result = await searchItinerary([visit('a'), visit('b')], {
      timeBudgetMs: 5,
      lockedItemIds: new Set(),
      evaluate: async (items) => {
        calls += 1;
        if (calls === 1) return { items, valid: true, metrics: metrics() };
        return new Promise<SearchEvaluation>((_resolve, reject) => {
          setTimeout(() => reject(new Error('late provider failure')), 15);
        });
      },
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(result.terminationReason).toBe('TIME_LIMIT');
    expect(result.after.valid).toBe(true);
    expect(ids(result.items)).toBe('ab');
  });

  it('reports when no constraint-valid candidate exists', async () => {
    const result = await searchItinerary([visit('a'), visit('b')], {
      lockedItemIds: new Set(),
      evaluate: evaluateWith(
        () => ({}),
        () => false,
      ),
    });

    expect(result.terminationReason).toBe('NO_VALID_CANDIDATE');
    expect(result.after.valid).toBe(false);
  });
});
