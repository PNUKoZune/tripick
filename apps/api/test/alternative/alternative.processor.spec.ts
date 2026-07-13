/// <reference types="jest" />

import { AlternativeProcessor } from '../../src/alternative/alternative.processor';
import { REPLAN_JOB } from '../../src/replanning/replanning.constants';
import type { Job } from 'bullmq';
import type { ReplanRequestDto } from '@tripick/types';

function job(over: Partial<Job<ReplanRequestDto>> = {}): Job<ReplanRequestDto> {
  return {
    id: 'job-1',
    name: REPLAN_JOB,
    data: { tripId: 'trip-1', trigger: 'waiting', waitingMinutes: 30 },
    ...over,
  } as Job<ReplanRequestDto>;
}

describe('AlternativeProcessor', () => {
  const planner = { replan: jest.fn() };
  const gateway = { pushReplanResult: jest.fn() };
  const processor = new AlternativeProcessor(planner as any, gateway as any);

  beforeEach(() => jest.clearAllMocks());

  it('ignores jobs whose name is not the replan job', async () => {
    await processor.process(job({ name: 'other-job' }));
    expect(planner.replan).not.toHaveBeenCalled();
    expect(gateway.pushReplanResult).not.toHaveBeenCalled();
  });

  it('replans and pushes a completed result with the updated items', async () => {
    const updatedItems = [{ id: 'i1', name: '대체 카페' }];
    planner.replan.mockResolvedValue(updatedItems);

    await processor.process(job());

    expect(planner.replan).toHaveBeenCalledWith(
      expect.objectContaining({ tripId: 'trip-1', trigger: 'waiting' }),
    );
    expect(gateway.pushReplanResult).toHaveBeenCalledTimes(1);
    const result = gateway.pushReplanResult.mock.calls[0][0];
    expect(result).toMatchObject({
      jobId: 'job-1',
      tripId: 'trip-1',
      status: 'completed',
      updatedItems,
    });
    expect(typeof result.completedAt).toBe('string');
  });

  it('pushes a failed result and rethrows so BullMQ retries', async () => {
    planner.replan.mockRejectedValue(new Error('llm timeout'));

    await expect(processor.process(job())).rejects.toThrow('llm timeout');

    expect(gateway.pushReplanResult).toHaveBeenCalledTimes(1);
    expect(gateway.pushReplanResult.mock.calls[0][0]).toMatchObject({
      jobId: 'job-1',
      tripId: 'trip-1',
      status: 'failed',
    });
  });
});
