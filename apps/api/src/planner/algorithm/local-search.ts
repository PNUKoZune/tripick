import type { ItineraryItemDto } from '@tripick/types';

export interface SearchMetrics {
  pinMisses: number;
  shortfall: number;
  targetShortfall: number;
  travelTimeMin: number | null;
  preferenceScore: number | null;
}

export interface SearchEvaluation {
  valid: boolean;
  items: ItineraryItemDto[];
  metrics: SearchMetrics;
}

export type SearchTerminationReason =
  | 'LOCAL_OPTIMUM'
  | 'EVALUATION_LIMIT'
  | 'TIME_LIMIT'
  | 'CANCELLED'
  | 'NO_VALID_CANDIDATE';

export class SearchDeadlineError extends Error {
  constructor(readonly reason: 'TIME_LIMIT' | 'CANCELLED') {
    super(`Itinerary search stopped: ${reason}`);
    this.name = 'SearchDeadlineError';
  }
}

interface SearchOptions<T extends SearchEvaluation> {
  evaluate: (items: ItineraryItemDto[], signal: AbortSignal) => Promise<T>;
  lockedItemIds: ReadonlySet<string>;
  maxEvaluations?: number;
  timeBudgetMs?: number;
  signal?: AbortSignal;
  now?: () => number;
}

export interface SearchResult<T extends SearchEvaluation> {
  items: ItineraryItemDto[];
  before: T;
  after: T;
  evaluations: number;
  terminationReason: SearchTerminationReason;
  elapsedMs: number;
}

/**
 * Deterministic first-improvement search. Locks split each day into independent
 * runs, so a visit cannot move across a lock even when its own time is flexible.
 * The evaluator owns schedule reflow and constraint/ETA checks for every order.
 */
export async function searchItinerary<T extends SearchEvaluation>(
  initial: ItineraryItemDto[],
  options: SearchOptions<T>,
): Promise<SearchResult<T>> {
  const now = options.now ?? (() => performance.now());
  const startedAt = now();
  const wallStartedAt = performance.now();
  const budget = clamp(options.timeBudgetMs, 0, 2_000, 2_000);
  const maxEvaluations = Math.floor(clamp(options.maxEvaluations, 1, 50, 50));
  const deadline = startedAt + budget;
  const wallDeadline = wallStartedAt + budget;
  const original = cloneItems(initial);
  const segments = unlockedSegments(original, options.lockedItemIds);
  let evaluations = 0;

  const stopped = (): 'CANCELLED' | 'TIME_LIMIT' | undefined => {
    if (options.signal?.aborted) return 'CANCELLED';
    if (now() >= deadline || performance.now() >= wallDeadline) return 'TIME_LIMIT';
    return undefined;
  };

  const evaluate = async (candidate: ItineraryItemDto[]): Promise<T> => {
    const reason = stopped();
    if (reason) throw new SearchDeadlineError(reason);
    evaluations += 1;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortListener: (() => void) | undefined;

    // A separate rejection path bounds waiting even when an ETA provider ignores
    // AbortSignal. Promise.race observes late provider rejections as well.
    const interruption = new Promise<never>((_resolve, reject) => {
      const interrupt = (nextReason: 'TIME_LIMIT' | 'CANCELLED'): void => {
        reject(new SearchDeadlineError(nextReason));
        controller.abort();
      };
      abortListener = () => interrupt('CANCELLED');
      options.signal?.addEventListener('abort', abortListener, { once: true });
      timer = setTimeout(
        () => interrupt('TIME_LIMIT'),
        Math.max(0, Math.min(deadline - now(), wallDeadline - performance.now())),
      );
    });

    try {
      const result = await Promise.race([
        Promise.resolve().then(() => {
          if (controller.signal.aborted) {
            throw new SearchDeadlineError(options.signal?.aborted ? 'CANCELLED' : 'TIME_LIMIT');
          }
          return options.evaluate(cloneItems(candidate), controller.signal);
        }),
        interruption,
      ]);
      const afterReason = stopped();
      if (afterReason) {
        controller.abort();
        throw new SearchDeadlineError(afterReason);
      }
      const intact = preservesItems(original, candidate, result.items, options.lockedItemIds);
      return {
        ...result,
        valid: result.valid && intact,
        // Untrusted evaluator output must not leak changed lock/visit metadata.
        items: cloneItems(intact ? result.items : candidate),
        metrics: { ...result.metrics },
      };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (abortListener) options.signal?.removeEventListener('abort', abortListener);
    }
  };

  // Without this result there are no trustworthy metrics to report. Callers can
  // retain their baseline when this bounded first evaluation is interrupted.
  const before = await evaluate(original);
  let best = before;
  const visited = new Set([orderKey(original)]);
  let terminationReason: SearchTerminationReason = 'LOCAL_OPTIMUM';

  search: while (true) {
    let improved = false;
    for (const candidate of neighbors(best.items, segments)) {
      const reason = stopped();
      if (reason) {
        terminationReason = reason;
        break search;
      }
      if (evaluations >= maxEvaluations) {
        terminationReason = 'EVALUATION_LIMIT';
        break search;
      }
      const key = orderKey(candidate);
      if (visited.has(key)) continue;
      visited.add(key);
      let result: T;
      try {
        result = await evaluate(candidate);
      } catch (error) {
        if (error instanceof SearchDeadlineError) {
          terminationReason = error.reason;
          break search;
        }
        // A provider failure for one candidate cannot discard an evaluated best.
        continue;
      }
      if (better(result, best)) {
        best = result;
        improved = true;
        break;
      }
    }
    if (!improved) {
      terminationReason = best.valid ? 'LOCAL_OPTIMUM' : 'NO_VALID_CANDIDATE';
      break;
    }
  }

  return {
    items: cloneItems(best.items),
    before,
    after: best,
    evaluations,
    terminationReason,
    elapsedMs: Math.max(0, now() - startedAt, performance.now() - wallStartedAt),
  };
}

function better(candidate: SearchEvaluation, current: SearchEvaluation): boolean {
  if (candidate.valid !== current.valid) return candidate.valid;
  for (const metric of ['pinMisses', 'shortfall'] as const) {
    const next = finiteOrInfinity(candidate.metrics[metric]);
    const previous = finiteOrInfinity(current.metrics[metric]);
    if (next !== previous) return next < previous;
  }
  const nextEta = finiteOrInfinity(candidate.metrics.travelTimeMin);
  const previousEta = finiteOrInfinity(current.metrics.travelTimeMin);
  // Unknown ETA never beats known ETA. Target and preference are report-only.
  return nextEta < previousEta;
}

function finiteOrInfinity(value: number | null): number {
  return value !== null && Number.isFinite(value) && value >= 0 ? value : Infinity;
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  return value === undefined || Number.isNaN(value)
    ? fallback
    : Math.min(max, Math.max(min, value));
}

function cloneItems(items: ItineraryItemDto[]): ItineraryItemDto[] {
  return structuredClone(items);
}

function orderKey(items: ItineraryItemDto[]): string {
  return JSON.stringify(items.map((item) => item.id));
}

function unlockedSegments(items: ItineraryItemDto[], locks: ReadonlySet<string>): number[][] {
  const result: number[][] = [];
  let segment: number[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    if (locks.has(item.id) || (index > 0 && item.day !== items[index - 1]!.day)) {
      if (segment.length > 1) result.push(segment);
      segment = [];
    }
    if (!locks.has(item.id)) segment.push(index);
  }
  if (segment.length > 1) result.push(segment);
  return result;
}

function* neighbors(
  items: ItineraryItemDto[],
  segments: number[][],
): Generator<ItineraryItemDto[]> {
  for (const segment of segments) {
    // Adjacent swaps first, then larger swaps, then both insertion directions.
    for (let distance = 1; distance < segment.length; distance += 1) {
      for (let from = 0; from + distance < segment.length; from += 1) {
        const left = segment[from]!;
        const right = segment[from + distance]!;
        const next = items.slice();
        [next[left], next[right]] = [next[right]!, next[left]!];
        yield next;
      }
    }
    for (let from = 0; from < segment.length; from += 1) {
      for (let to = 0; to < segment.length; to += 1) {
        if (Math.abs(from - to) < 2) continue; // Covered by swaps above.
        const moved = segment.map((index) => items[index]!);
        moved.splice(to, 0, moved.splice(from, 1)[0]!);
        const next = items.slice();
        segment.forEach((index, offset) => {
          next[index] = moved[offset]!;
        });
        yield next;
      }
    }
  }
}

function preservesItems(
  original: ItineraryItemDto[],
  candidate: ItineraryItemDto[],
  evaluated: ItineraryItemDto[],
  locks: ReadonlySet<string>,
): boolean {
  if (evaluated.length !== original.length) return false;
  const byId = new Map(original.map((item) => [item.id, item]));
  if (byId.size !== original.length) return false;
  return evaluated.every((item, index) => {
    if (item.id !== candidate[index]!.id) return false;
    const source = byId.get(item.id);
    if (!source) return false;
    if (locks.has(item.id)) return sameValue(item, original[index]);
    return sameValue(metadata(item), metadata(source));
  });
}

/** DTOs are JSON values; cloning across a VM must not change their equality. */
function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left) && Array.isArray(right) && left.length !== right.length) return false;
  const leftObject = left as Record<string, unknown>;
  const rightObject = right as Record<string, unknown>;
  const keys = Object.keys(leftObject);
  return (
    keys.length === Object.keys(rightObject).length &&
    keys.every(
      (key) => Object.hasOwn(rightObject, key) && sameValue(leftObject[key], rightObject[key]),
    )
  );
}

function metadata(
  item: ItineraryItemDto,
): Omit<ItineraryItemDto, 'order' | 'scheduledAt' | 'travelTimeMin'> {
  const { order: _order, scheduledAt: _scheduledAt, travelTimeMin: _travelTimeMin, ...rest } = item;
  return rest;
}
