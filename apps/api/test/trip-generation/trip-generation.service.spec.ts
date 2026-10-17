/// <reference types="jest" />
import { BadRequestException } from '@nestjs/common';
import { TripGenerationService } from '../../src/trip-generation/trip-generation.service';
import { GenerationRequestEntity } from '../../src/trip-generation/generation-request.entity';

function request(over: Partial<GenerationRequestEntity> = {}): GenerationRequestEntity {
  return { id: 'request-1', tripId: 'trip-1', userId: 'user-1', state: 'queued', attempt: 0,
    maxAttempts: 3, version: 0, error: null, ...over } as GenerationRequestEntity;
}
function setup(row: GenerationRequestEntity | null = request()) {
  const queue = { getJob: jest.fn().mockResolvedValue(null), add: jest.fn().mockResolvedValue({}) };
  const ledger = { latest: jest.fn().mockResolvedValue(row), retry: jest.fn().mockResolvedValue(row),
    cancel: jest.fn().mockResolvedValue(row), publishPending: jest.fn(async (publish: (value: GenerationRequestEntity) => Promise<boolean>) => {
      if (row) await publish(row);
    }),
  };
  const service = new TripGenerationService(queue as never, ledger as never);
  return { service, queue, ledger };
}

describe('TripGenerationService durable publisher', () => {
  it('uses immutable request id instead of trip id for a retry delivery', async () => {
    const { service, queue } = setup();
    await service.publishPending();
    expect(queue.add).toHaveBeenCalledWith('generate-trip', { tripId: 'trip-1', userId: 'user-1', generationId: 'request-1' },
      expect.objectContaining({ jobId: 'trip-generation-request-1', attempts: 3 }));
  });
  it('keeps an accepted request queued while Redis publication fails', async () => {
    const { service, queue } = setup();
    queue.add.mockRejectedValue(new Error('redis offline'));
    await expect(service.publishPending()).resolves.toBeUndefined();
    await expect(service.getStatus('trip-1', 'generating')).resolves.toMatchObject({ requestState: 'queued', canCancel: true });
  });
  it('recreates a completed delivery only when its persisted request still waits', async () => {
    const { service, queue } = setup();
    const job = { getState: jest.fn().mockResolvedValue('completed'), remove: jest.fn().mockResolvedValue(undefined) };
    queue.getJob.mockResolvedValue(job);
    await service.publishPending();
    expect(job.remove).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledTimes(1);
  });
  it('refuses direct queue registration without durable admission', async () => {
    const { service, queue } = setup();
    await expect(service.enqueue({ tripId: 'trip-1', userId: 'user-1' })).rejects.toBeInstanceOf(BadRequestException);
    expect(queue.add).not.toHaveBeenCalled();
  });
});

describe('TripGenerationService DB-owned status', () => {
  it.each(['cancel_requested', 'cancelled', 'reconciling', 'failed'] as const)('exposes %s without Redis', async (state) => {
    const { service, queue } = setup(request({ state }));
    await expect(service.getStatus('trip-1', 'generating')).resolves.toMatchObject({ status: state, requestState: state, canCancel: false });
    expect(queue.getJob).not.toHaveBeenCalled();
  });
  it('does not replace succeeded state with a stale failed queue job', async () => {
    const { service, queue } = setup(request({ state: 'succeeded' }));
    await expect(service.getStatus('trip-1', 'confirmed')).resolves.toMatchObject({ status: 'completed', progress: 100 });
    expect(queue.getJob).not.toHaveBeenCalled();
  });
  it('keeps DB running state when Redis progress lookup fails', async () => {
    const { service, queue } = setup(request({ state: 'running', attempt: 1 }));
    queue.getJob.mockRejectedValue(new Error('redis offline'));
    await expect(service.getStatus('trip-1', 'generating')).resolves.toMatchObject({ status: 'processing', requestState: 'running', attempt: 1 });
  });
  it('reads legacy completion from the trip when no ledger exists', async () => {
    const { service } = setup(null);
    await expect(service.getStatus('trip-1', 'confirmed')).resolves.toMatchObject({ status: 'completed', progress: 100 });
  });
});
