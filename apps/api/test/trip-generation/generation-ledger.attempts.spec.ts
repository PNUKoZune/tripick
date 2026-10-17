/// <reference types="jest" />
import { GenerationLedgerService } from '../../src/trip-generation/generation-ledger.service';
import type { GenerationRequestEntity } from '../../src/trip-generation/generation-request.entity';

function setup(over: Partial<GenerationRequestEntity> = {}) {
  const row = { id: 'request-1', tripId: 'trip-1', userId: 'user-1', state: 'queued', version: 2,
    attempt: 2, maxAttempts: 3, publishedAt: new Date(), finishedAt: null, ...over } as GenerationRequestEntity;
  const repo = { findOne: jest.fn(async () => row), count: jest.fn(async () => 0), update: jest.fn() };
  const manager = { getRepository: jest.fn(() => repo), query: jest.fn(), save: jest.fn(async (value: unknown) => value) };
  const source = { transaction: jest.fn(async (write: (value: typeof manager) => Promise<unknown>) => write(manager)) };
  return { service: new GenerationLedgerService(source as never), row, repo, manager };
}
const data = { tripId: 'trip-1', userId: 'user-1', generationId: 'request-1' };

describe('GenerationLedgerService durable attempt budget', () => {
  it('refuses an execution beyond the DB budget after delivery counters reset', async () => {
    const { service, row, repo } = setup({ attempt: 3 });
    await expect(service.claim(data)).resolves.toBeNull();
    expect(row).toMatchObject({ state: 'failed', attempt: 3, version: 3 });
    expect(row.finishedAt).toBeInstanceOf(Date);
    expect(repo.update).toHaveBeenCalledWith({ id: 'trip-1', status: 'generating' }, { status: 'generation_failed' });
  });
  it('makes the last DB attempt final even when the fresh Redis job says retryable', async () => {
    const { service, row, repo } = setup();
    const execution = await service.claim(data);
    expect(execution).toEqual({ id: row.id, version: 3 });
    expect(row.attempt).toBe(3);
    await service.fail(execution!, new Error('model failed'), false);
    expect(row).toMatchObject({ state: 'failed', attempt: 3 });
    expect(repo.update).toHaveBeenCalledWith({ id: 'trip-1', status: 'generating' }, { status: 'generation_failed' });
  });
  it('preserves remaining attempts on a retryable failure before the DB limit', async () => {
    const { service, row, repo } = setup({ state: 'running', attempt: 2 });
    await service.fail({ id: row.id, version: row.version }, new Error('model failed'), false);
    expect(row).toMatchObject({ state: 'queued', attempt: 2, finishedAt: null });
    expect(repo.update).not.toHaveBeenCalled();
  });
  it('does not spend an attempt when another unresolved execution blocks dispatch', async () => {
    const { service, row, repo } = setup();
    repo.count.mockResolvedValue(1);
    await expect(service.claim(data)).resolves.toBeNull();
    expect(row).toMatchObject({ state: 'queued', attempt: 2, version: 2, publishedAt: null });
    expect(repo.update).not.toHaveBeenCalled();
  });
  it('keeps requested cancellation authoritative on an exhausted attempt', async () => {
    const { service, row, repo } = setup({ state: 'cancel_requested', attempt: 3 });
    await service.fail({ id: row.id, version: row.version }, new Error('cancelled'), false);
    expect(row.state).toBe('cancelled');
    expect(repo.update).toHaveBeenCalledWith({ id: 'trip-1', status: 'generating' }, { status: 'cancelled' });
  });
});
