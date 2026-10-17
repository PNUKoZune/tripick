/// <reference types="jest" />
import { BadRequestException } from '@nestjs/common';
import { GenerationLedgerService } from '../../src/trip-generation/generation-ledger.service';
import { GenerationNotRunnableError } from '../../src/trip-generation/generation-errors';
import type { GenerationRequestEntity } from '../../src/trip-generation/generation-request.entity';

function setup(state: GenerationRequestEntity['state'] = 'running') {
  const row = { id: 'request-1', tripId: 'trip-1', state, version: 2,
    reconciliationEvidence: null, finishedAt: null } as GenerationRequestEntity;
  const repo = { findOne: jest.fn(async () => row), findOneBy: jest.fn(async () => row), update: jest.fn() };
  const manager = { getRepository: jest.fn(() => repo), save: jest.fn(async (value: unknown) => value) };
  const source = { getRepository: jest.fn(() => repo), transaction: jest.fn(async (write: (value: typeof manager) => Promise<unknown>) => write(manager)) };
  return { service: new GenerationLedgerService(source as never), row, manager, repo };
}

describe('GenerationLedgerService operator quarantine', () => {
  it.each(['running', 'cancel_requested'] as const)('fences %s without releasing the occupied request', async (state) => {
    const { service, row, manager, repo } = setup(state);
    await service.quarantine(row.id, 'Worker host was lost and Redis delivery no longer exists.');
    expect(repo.findOne).toHaveBeenCalledWith({ where: { id: row.id }, lock: { mode: 'pessimistic_write' } });
    expect(row).toMatchObject({ state: 'reconciling', version: 3, finishedAt: null });
    expect(row.reconciliationEvidence).toContain('quarantine: Worker host was lost');
    expect(manager.save).toHaveBeenCalledTimes(1);
    expect(repo.update).not.toHaveBeenCalled();
    await expect(service.assertRunnable({ id: row.id, version: 2 })).rejects.toBeInstanceOf(GenerationNotRunnableError);
  });
  it('is idempotent after a request is already reconciling', async () => {
    const { service, row, manager } = setup('reconciling');
    row.reconciliationEvidence = 'existing quarantine evidence';
    await service.quarantine(row.id, 'Worker host was lost and Redis delivery no longer exists.');
    expect(row.version).toBe(2);
    expect(row.reconciliationEvidence).toBe('existing quarantine evidence');
    expect(manager.save).not.toHaveBeenCalled();
  });
  it.each(['queued', 'succeeded', 'failed', 'cancelled'] as const)('does not quarantine a %s request', async (state) => {
    const { service, manager } = setup(state);
    await expect(service.quarantine('request-1', 'Worker host was lost and Redis delivery no longer exists.')).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.save).not.toHaveBeenCalled();
  });
  it('requires operator evidence before any transaction starts', async () => {
    const { service, manager } = setup();
    await expect(service.quarantine('request-1', 'unknown')).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.getRepository).not.toHaveBeenCalled();
  });
  it('retains quarantine evidence when an independently verified termination is reconciled', async () => {
    const { service, row } = setup();
    await service.quarantine(row.id, 'Worker host was lost and Redis delivery no longer exists.');
    await service.reconcile(row.id, 'Model process restart confirmed by operator at deployment revision 42.');
    expect(row.state).toBe('failed');
    expect(row.version).toBe(4);
    expect(row.reconciliationEvidence).toContain('quarantine: Worker host was lost');
    expect(row.reconciliationEvidence).toContain('failed: Model process restart confirmed');
  });
});
