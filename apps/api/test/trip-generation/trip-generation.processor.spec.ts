/// <reference types="jest" />

import { TripGenerationProcessor } from '../../src/trip-generation/trip-generation.processor';
import { GenerationNotRunnableError } from '../../src/trip-generation/generation-errors';
import type { PlannerExecutionGuard } from '../../src/planner/planner.service';
import type { TripGenerationStage } from '@tripick/types';

interface FakeJob {
  name: string;
  timestamp: number;
  data: { tripId: string; userId: string; generationId: string };
  opts: { attempts: number };
  attemptsMade: number;
  updateProgress: jest.Mock<Promise<void>, [unknown]>;
}

function makeJob(over: Partial<FakeJob> = {}): FakeJob {
  return {
    name: 'generate-trip',
    timestamp: Date.now() - 500,
    data: { tripId: 'trip-1', userId: 'user-1', generationId: 'generation-1' },
    opts: { attempts: 3 },
    attemptsMade: 0,
    updateProgress: jest.fn().mockResolvedValue(undefined),
    ...over,
  };
}

function createHarness(deadlineMs = 300_000) {
  const execution = { id: 'generation-1', version: 1 };
  const manager = { transaction: jest.fn() };
  const ledger = {
    claim: jest.fn().mockResolvedValue(execution),
    assertRunnable: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn(async (_execution, write) => write(manager)),
    fail: jest.fn().mockResolvedValue(undefined),
    expire: jest.fn().mockResolvedValue(undefined),
  };
  const plannerService = {
    generateItinerary: jest.fn(async (
      _tripId: string,
      report: (stage: TripGenerationStage, progress: number) => Promise<void>,
      guard: PlannerExecutionGuard,
    ) => {
      await guard.assertRunnable();
      await report('preparing', 15);
      await report('discovering_places', 35);
      await report('building_itinerary', 65);
      await report('saving', 90);
      return guard.commit(async () => [{ id: 'item-1' }]);
    }),
  };
  const config = { get: jest.fn().mockReturnValue(deadlineMs) };
  return {
    processor: new TripGenerationProcessor(plannerService as never, ledger as never, config as never),
    execution, ledger, plannerService, manager,
  };
}

describe('TripGenerationProcessor', () => {
  afterEach(() => jest.useRealTimers());

  it('claims execution, forwards real planner stages and commits through the ledger', async () => {
    const { processor, ledger, execution } = createHarness();
    const job = makeJob();

    await expect(processor.process(job as never)).resolves.toEqual({
      tripId: 'trip-1',
      itemCount: 1,
    });
    expect(ledger.claim).toHaveBeenCalledWith(job.data);
    expect(ledger.commit).toHaveBeenCalledWith(execution, expect.any(Function));
    expect(job.updateProgress.mock.calls).toEqual([
      [{ stage: 'preparing', progress: 15 }],
      [{ stage: 'discovering_places', progress: 35 }],
      [{ stage: 'building_itinerary', progress: 65 }],
      [{ stage: 'saving', progress: 90 }],
      [{ stage: 'completed', progress: 100 }],
    ]);
  });

  it('skips already-completed, cancelled or stale delivery when the ledger denies claim', async () => {
    const { processor, plannerService, ledger } = createHarness();
    ledger.claim.mockResolvedValue(null);

    await expect(processor.process(makeJob({ attemptsMade: 1 }) as never)).resolves.toMatchObject({ skipped: true });
    expect(plannerService.generateItinerary).not.toHaveBeenCalled();
    expect(ledger.fail).not.toHaveBeenCalled();
  });

  it('marks failure terminal only after the final automatic attempt', async () => {
    const { processor, plannerService, ledger, execution } = createHarness();
    const failure = new Error('LLM unavailable');
    plannerService.generateItinerary.mockRejectedValue(failure);

    await expect(processor.process(makeJob({ attemptsMade: 2 }) as never)).rejects.toThrow('LLM unavailable');
    expect(ledger.fail).toHaveBeenCalledWith(execution, failure, true);
  });

  it('allows safe retries for an ordinary failure before the final attempt', async () => {
    const { processor, plannerService, ledger, execution } = createHarness();
    const failure = new Error('provider rejected request');
    plannerService.generateItinerary.mockRejectedValue(failure);

    await expect(processor.process(makeJob() as never)).rejects.toThrow(failure);
    expect(ledger.fail).toHaveBeenCalledWith(execution, failure, false);
  });

  it('holds the live execution until inference settles and discards a cancelled late result', async () => {
    const { processor, plannerService, ledger, execution } = createHarness();
    let release!: () => void;
    const inference = new Promise<void>((resolve) => { release = resolve; });
    let cancelled = false;
    ledger.assertRunnable.mockImplementation(async () => {
      if (cancelled) throw new GenerationNotRunnableError();
    });
    plannerService.generateItinerary.mockImplementation(async (_trip, _report, guard) => {
      await inference;
      await guard.assertRunnable();
      return guard.commit(async () => [{ id: 'late' }]);
    });
    const running = processor.process(makeJob() as never);
    await Promise.resolve();
    cancelled = true;

    expect(ledger.fail).not.toHaveBeenCalled();
    release();
    await expect(running).resolves.toMatchObject({ skipped: true });
    expect(ledger.commit).not.toHaveBeenCalled();
    expect(ledger.fail).toHaveBeenCalledWith(execution, expect.any(GenerationNotRunnableError), true);
  });

  it('fences on whole-run deadline while continuing to await the actual inference', async () => {
    jest.useFakeTimers();
    const { processor, plannerService, ledger, execution } = createHarness(20);
    let release!: () => void;
    const inference = new Promise<void>((resolve) => { release = resolve; });
    plannerService.generateItinerary.mockImplementation(async (_trip, _report, guard) => {
      await inference;
      await guard.assertRunnable();
      return guard.commit(async () => [{ id: 'late' }]);
    });
    const running = processor.process(makeJob() as never);
    let settled = false;
    void running.then(() => { settled = true; }, () => { settled = true; });
    await jest.advanceTimersByTimeAsync(21);

    expect(ledger.expire).toHaveBeenCalledWith(execution);
    expect(ledger.fail).not.toHaveBeenCalled();
    expect(settled).toBe(false);
    release();
    await expect(running).rejects.toThrow('전체 실행 제한 시간');
    expect(ledger.commit).not.toHaveBeenCalled();
    expect(ledger.fail).toHaveBeenCalledWith(execution, expect.any(Error), true);
  });

  it('retains a reconciliation fence when model completion cannot be proven', async () => {
    const { processor, plannerService, ledger, execution } = createHarness();
    const failure = Object.assign(new Error('model completion uncertain'), { code: 'MODEL_COMPLETION_UNCERTAIN' });
    plannerService.generateItinerary.mockRejectedValue(failure);

    await expect(processor.process(makeJob() as never)).rejects.toThrow('model completion uncertain');
    expect(ledger.expire).toHaveBeenCalledWith(execution);
    expect(ledger.fail).toHaveBeenCalledWith(execution, failure, true);
    expect(ledger.commit).not.toHaveBeenCalled();
  });

  it('keeps uncertain model completion visible among failures from parallel place searches', async () => {
    const { processor, plannerService, ledger, execution } = createHarness();
    const uncertain = Object.assign(new Error('remote inference still unknown'), { code: 'MODEL_COMPLETION_UNCERTAIN' });
    const failure = new AggregateError([new Error('another region failed'), uncertain], 'parallel retrieval failed');
    plannerService.generateItinerary.mockRejectedValue(failure);

    await expect(processor.process(makeJob() as never)).rejects.toThrow('parallel retrieval failed');
    expect(ledger.expire).toHaveBeenCalledWith(execution);
    expect(ledger.fail).toHaveBeenCalledWith(execution, failure, true);
  });
});
