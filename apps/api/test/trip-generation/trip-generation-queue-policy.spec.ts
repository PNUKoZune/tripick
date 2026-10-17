import { ConfigService } from '@nestjs/config';
import { TripGenerationQueuePolicy } from '../../src/trip-generation/trip-generation-queue-policy.service';

function harness(value: string | number = 1, existing: number | null = null) {
  const queue = {
    getGlobalConcurrency: jest
      .fn()
      .mockResolvedValueOnce(existing)
      .mockResolvedValue(Number(value)),
    client: Promise.resolve({ hsetnx: jest.fn().mockResolvedValue(1) }),
    keys: { meta: 'test:meta' },
  };
  const processor = { worker: { run: jest.fn().mockResolvedValue(undefined) } };
  const service = new TripGenerationQueuePolicy(
    queue as never,
    processor as never,
    new ConfigService({ TRIP_GENERATION_GLOBAL_CONCURRENCY: value }),
  );
  return { service, queue, processor };
}

describe('TripGenerationQueuePolicy', () => {
  it('verifies the queue-wide limit before starting the worker', async () => {
    const { service, queue, processor } = harness();
    await service.onApplicationBootstrap();
    expect((await queue.client).hsetnx).toHaveBeenCalledWith('test:meta', 'concurrency', '1');
    expect(queue.getGlobalConcurrency).toHaveBeenCalledTimes(2);
    expect(queue.getGlobalConcurrency.mock.invocationCallOrder[1]).toBeLessThan(
      processor.worker.run.mock.invocationCallOrder[0]!,
    );
  });

  it('fails closed if a different replica has a conflicting limit', async () => {
    const { service, queue, processor } = harness(1, 2);
    await expect(service.onApplicationBootstrap()).rejects.toThrow('limit mismatch');
    expect((await queue.client).hsetnx).not.toHaveBeenCalled();
    expect(processor.worker.run).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, 'oops', 21])(
    'rejects invalid limit %s before starting the worker',
    async (value) => {
      const { service, processor } = harness(value);
      await expect(service.onApplicationBootstrap()).rejects.toThrow('must be an integer');
      expect(processor.worker.run).not.toHaveBeenCalled();
    },
  );
});
