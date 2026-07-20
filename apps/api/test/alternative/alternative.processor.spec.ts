/// <reference types="jest" />

import { AlternativeProcessor } from '../../src/alternative/alternative.processor';
import { REPLAN_JOB } from '../../src/replanning/replanning.constants';
import type { Job } from 'bullmq';
import type { ReplanRequestDto } from '@tripick/types';

function job(over: Partial<Job<ReplanRequestDto>> = {}): Job<ReplanRequestDto> {
  return {
    id: 'job-1',
    name: REPLAN_JOB,
    data: { tripId: 'trip-1', trigger: 'deviation' },
    opts: { attempts: 3 },
    attemptsMade: 0,
    ...over,
  } as Job<ReplanRequestDto>;
}

describe('AlternativeProcessor', () => {
  const planner = { replan: jest.fn() };
  const gateway = { pushReplanResult: jest.fn() };
  const inbox = { create: jest.fn() };
  const tripMembers = {
    getNotificationTargets: jest.fn(async () => ({
      tripTitle: '부산 여행',
      userIds: ['owner-1', 'member-2'],
    })),
  };
  const processor = new AlternativeProcessor(
    planner as any,
    gateway as any,
    inbox as any,
    tripMembers as any,
  );

  beforeEach(() => jest.clearAllMocks());

  it('ignores jobs whose name is not the replan job', async () => {
    await processor.process(job({ name: 'other-job' }));
    expect(planner.replan).not.toHaveBeenCalled();
    expect(gateway.pushReplanResult).not.toHaveBeenCalled();
    expect(inbox.create).not.toHaveBeenCalled();
  });

  it('replans and pushes a completed result with the updated items', async () => {
    const updatedItems = [{ id: 'i1', name: '대체 카페' }];
    planner.replan.mockResolvedValue(updatedItems);

    await processor.process(job());

    expect(planner.replan).toHaveBeenCalledWith(
      expect.objectContaining({ tripId: 'trip-1', trigger: 'deviation' }),
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

  it('notifies every trip recipient on a completed replan', async () => {
    planner.replan.mockResolvedValue([]);

    await processor.process(job());

    expect(inbox.create).toHaveBeenCalledTimes(2);
    const userIds = inbox.create.mock.calls.map((call) => call[0].userId).sort();
    expect(userIds).toEqual(['member-2', 'owner-1']);
    expect(inbox.create.mock.calls[0][0]).toMatchObject({
      category: 'replan_ready',
      title: '재계획 완료',
      payload: { tripId: 'trip-1', status: 'completed' },
    });
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

  it('stays silent on a mid-retry failure (not the final attempt)', async () => {
    planner.replan.mockRejectedValue(new Error('llm timeout'));

    await expect(processor.process(job({ attemptsMade: 0 }))).rejects.toThrow();

    expect(inbox.create).not.toHaveBeenCalled();
  });

  it('notifies recipients only once retries are exhausted', async () => {
    planner.replan.mockRejectedValue(new Error('llm timeout'));

    // attemptsMade 2 (0-index) + 1 === attempts 3 → 최종 시도
    await expect(processor.process(job({ attemptsMade: 2 }))).rejects.toThrow();

    expect(inbox.create).toHaveBeenCalledTimes(2);
    expect(inbox.create.mock.calls[0][0]).toMatchObject({
      title: '재계획 실패',
      payload: { status: 'failed' },
    });
  });
});
