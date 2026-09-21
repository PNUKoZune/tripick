/// <reference types="jest" />

import { BadRequestException } from '@nestjs/common';
import { TripGenerationService } from '../../src/trip-generation/trip-generation.service';

interface FakeJob {
  id: string;
  data: { tripId: string; userId: string };
  opts: { attempts: number };
  attemptsMade: number;
  progress: number | { stage: string; progress: number };
  failedReason: string | undefined;
  getState: jest.Mock<Promise<string>, []>;
  remove: jest.Mock<Promise<void>, []>;
}

function makeJob(over: Partial<FakeJob> = {}): FakeJob {
  return {
    id: 'trip-generation-trip-1',
    data: { tripId: 'trip-1', userId: 'user-1' },
    opts: { attempts: 3 },
    attemptsMade: 0,
    progress: 0,
    failedReason: undefined,
    getState: jest.fn().mockResolvedValue('waiting'),
    remove: jest.fn().mockResolvedValue(undefined),
    ...over,
  };
}

function createHarness(existing?: FakeJob) {
  const added = makeJob();
  const queue = {
    getJob: jest.fn().mockResolvedValue(existing),
    add: jest.fn().mockResolvedValue(added),
  };
  return { service: new TripGenerationService(queue as never), queue, added };
}

describe('TripGenerationService', () => {
  it('uses one deterministic job id and exposes queued progress', async () => {
    const { service, queue } = createHarness();
    const result = await service.enqueue({ tripId: 'trip-1', userId: 'user-1' });

    expect(queue.add).toHaveBeenCalledWith(
      'generate-trip',
      { tripId: 'trip-1', userId: 'user-1' },
      expect.objectContaining({ jobId: 'trip-generation-trip-1' }),
    );
    expect(result).toMatchObject({ status: 'queued', stage: 'queued', progress: 5 });
  });

  it('coalesces an already-active job instead of registering duplicate LLM work', async () => {
    const active = makeJob({
      attemptsMade: 1,
      progress: { stage: 'building_itinerary', progress: 65 },
      getState: jest.fn().mockResolvedValue('active'),
    });
    const { service, queue } = createHarness(active);

    const result = await service.enqueue({ tripId: 'trip-1', userId: 'user-1' });

    expect(queue.add).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'retrying',
      stage: 'building_itinerary',
      progress: 65,
      attempt: 2,
    });
  });

  it('uses persisted trip completion even after the queue job expires', async () => {
    const { service, queue } = createHarness();
    await expect(service.getStatus('trip-1', 'confirmed')).resolves.toMatchObject({
      status: 'completed',
      stage: 'completed',
      progress: 100,
    });
    expect(queue.getJob).not.toHaveBeenCalled();
  });

  it('keeps final failure retryable when Redis no longer has the job', async () => {
    const { service } = createHarness();
    await expect(service.getStatus('trip-1', 'generation_failed')).resolves.toMatchObject({
      status: 'failed',
      progress: 0,
    });
    expect(() => service.assertRetryable('generation_failed')).not.toThrow();
    expect(() => service.assertRetryable('generating')).toThrow(BadRequestException);
  });
});
