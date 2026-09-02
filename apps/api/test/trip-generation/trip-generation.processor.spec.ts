/// <reference types="jest" />

import { TripGenerationProcessor } from '../../src/trip-generation/trip-generation.processor';
import type { TripGenerationStage } from '@tripick/types';

interface FakeJob {
  name: string;
  data: { tripId: string; userId: string };
  opts: { attempts: number };
  attemptsMade: number;
  updateProgress: jest.Mock<Promise<void>, [unknown]>;
}

function makeJob(over: Partial<FakeJob> = {}): FakeJob {
  return {
    name: 'generate-trip',
    data: { tripId: 'trip-1', userId: 'user-1' },
    opts: { attempts: 3 },
    attemptsMade: 0,
    updateProgress: jest.fn().mockResolvedValue(undefined),
    ...over,
  };
}

function createHarness(status = 'generating') {
  const tripsRepo = {
    findOneBy: jest.fn().mockResolvedValue({ id: 'trip-1', userId: 'user-1', status }),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const plannerService = {
    generateItinerary: jest.fn(async (
      _tripId: string,
      report: (stage: TripGenerationStage, progress: number) => Promise<void>,
    ) => {
      await report('preparing', 15);
      await report('discovering_places', 35);
      await report('building_itinerary', 65);
      await report('saving', 90);
      return [{ id: 'item-1' }];
    }),
  };
  return {
    processor: new TripGenerationProcessor(tripsRepo as never, plannerService as never),
    tripsRepo,
    plannerService,
  };
}

describe('TripGenerationProcessor', () => {
  it('forwards real planner stages to BullMQ and completes the job', async () => {
    const { processor } = createHarness();
    const job = makeJob();

    await expect(processor.process(job as never)).resolves.toEqual({
      tripId: 'trip-1',
      itemCount: 1,
    });
    expect(job.updateProgress.mock.calls).toEqual([
      [{ stage: 'preparing', progress: 15 }],
      [{ stage: 'discovering_places', progress: 35 }],
      [{ stage: 'building_itinerary', progress: 65 }],
      [{ stage: 'saving', progress: 90 }],
      [{ stage: 'completed', progress: 100 }],
    ]);
  });

  it('does not regenerate an already-confirmed itinerary on worker retry', async () => {
    const { processor, plannerService } = createHarness('confirmed');
    const job = makeJob({ attemptsMade: 1 });

    await expect(processor.process(job as never)).resolves.toMatchObject({ skipped: true });
    expect(plannerService.generateItinerary).not.toHaveBeenCalled();
  });

  it('persists generation_failed only after the final automatic attempt', async () => {
    const { processor, plannerService, tripsRepo } = createHarness();
    plannerService.generateItinerary.mockRejectedValue(new Error('LLM unavailable'));
    const job = makeJob({ attemptsMade: 2 });

    await expect(processor.process(job as never)).rejects.toThrow('LLM unavailable');
    expect(tripsRepo.update).toHaveBeenCalledWith(
      { id: 'trip-1' },
      { status: 'generation_failed' },
    );
  });
});
