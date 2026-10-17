/// <reference types="jest" />
import { ForbiddenException } from '@nestjs/common';
import { TripsService } from '../../src/trips/trips.service';
import { TripEntity } from '../../src/trips/trip.entity';
import { TripDayEntity } from '../../src/trips/trip-day.entity';
import type { EntityManager } from 'typeorm';

const dto = { title: '부산 그룹 여행', destination: '부산', startDate: '2026-09-10', endDate: '2026-09-11', wakeTime: '08:00', sleepTime: '23:00' };
function setup() {
  const saved = { id: 'trip-1', userId: 'owner', ...dto, status: 'generating' };
  const repo = { create: jest.fn((value: object) => ({ id: 'trip-1', ...value })), save: jest.fn().mockResolvedValue(saved),
    findOneBy: jest.fn().mockResolvedValue(saved), delete: jest.fn() };
  const days = { save: jest.fn(), create: jest.fn((value: object) => value) };
  const manager = { getRepository: jest.fn((entity: unknown) => entity === TripEntity ? repo : entity === TripDayEntity ? days : null) } as unknown as EntityManager;
  const ledger = { admit: jest.fn(async (_userId: string, _key: string | undefined, _input: unknown, create: (manager: EntityManager) => Promise<unknown>) => ({ trip: await create(manager), request: { id: 'request-1' }, replayed: false })) };
  const generation = { ledger, publishPending: jest.fn().mockResolvedValue(undefined), cancel: jest.fn() };
  const service = new TripsService(repo as never, days as never, {} as never, generation as never);
  return { service, repo, days, generation, ledger, manager, saved };
}

describe('TripsService transactional admission', () => {
  it('stores day regions and members through the admission manager before publication', async () => {
    const { service, generation, days, manager } = setup();
    const order: string[] = [];
    generation.publishPending.mockImplementation(async () => { order.push('publish'); });
    await service.create('owner', { ...dto, dayRegions: [['부산'], ['경주']] }, { beforeEnqueue: async (trip, transaction) => {
      expect(trip.id).toBe('trip-1'); expect(transaction).toBe(manager);
      expect(days.save).toHaveBeenCalledTimes(1); order.push('members');
    } });
    expect(order).toEqual(['members', 'publish']);
  });
  it('leaves rollback to the admission transaction when a related write fails', async () => {
    const { service, repo, generation } = setup();
    await expect(service.create('owner', dto, { beforeEnqueue: async () => { throw new Error('member write failed'); } })).rejects.toThrow('member write failed');
    expect(generation.publishPending).not.toHaveBeenCalled();
    expect(repo.delete).not.toHaveBeenCalled();
  });
  it('returns the same committed trip on replay without running related writes', async () => {
    const { service, ledger, saved } = setup();
    ledger.admit.mockImplementation(async () => ({ trip: saved, request: { id: 'request-1' }, replayed: true }));
    const prepare = jest.fn();
    await expect(service.create('owner', dto, { requestKey: 'req1', beforeEnqueue: prepare })).resolves.toBe(saved);
    expect(ledger.admit).toHaveBeenCalledWith('owner', 'req1', dto, expect.any(Function));
    expect(prepare).not.toHaveBeenCalled();
  });
  it('requires owner permission for cancellation, including accepted companions', async () => {
    const { service, repo, generation } = setup();
    repo.findOneBy.mockResolvedValue({ userId: 'different-owner' } as never);
    await expect(service.cancelGeneration('trip-1', 'companion')).rejects.toBeInstanceOf(ForbiddenException);
    expect(generation.cancel).not.toHaveBeenCalled();
  });
});
