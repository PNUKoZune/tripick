/// <reference types="jest" />

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ItineraryService } from '../../src/itinerary/itinerary.service';
import type { CreateItineraryItemDto } from '@tripick/types';

function createHarness() {
  const repo = {
    find: jest.fn(),
    delete: jest.fn().mockResolvedValue({ affected: 0 }),
    create: jest.fn((v: any) => v),
    save: jest.fn(async (v: any) => v),
  };
  const tripsRepo = { findOneBy: jest.fn() };
  const service = new ItineraryService(repo as any, tripsRepo as any);
  return { service, repo, tripsRepo };
}

const item = (over: Partial<CreateItineraryItemDto> = {}): CreateItineraryItemDto => ({
  tripId: 'trip-1',
  day: 1,
  order: 1,
  type: 'cafe',
  name: '광안리 카페',
  address: '부산',
  coordinates: { lat: 35.15, lng: 129.11 },
  scheduledAt: '2026-07-10T09:00:00.000Z',
  durationMin: 60,
  ...over,
});

describe('ItineraryService.findByTrip', () => {
  it('throws 404 when the trip does not exist', async () => {
    const { service, tripsRepo } = createHarness();
    tripsRepo.findOneBy.mockResolvedValue(null);
    await expect(service.findByTrip('trip-1', 'u1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws 403 when the caller does not own the trip', async () => {
    const { service, tripsRepo } = createHarness();
    tripsRepo.findOneBy.mockResolvedValue({ id: 'trip-1', userId: 'someone-else' });
    await expect(service.findByTrip('trip-1', 'u1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns items ordered by day then order for the owner', async () => {
    const { service, repo, tripsRepo } = createHarness();
    tripsRepo.findOneBy.mockResolvedValue({ id: 'trip-1', userId: 'u1' });
    repo.find.mockResolvedValue([item()]);

    const result = await service.findByTrip('trip-1', 'u1');

    expect(result).toHaveLength(1);
    expect(repo.find).toHaveBeenCalledWith({
      where: { tripId: 'trip-1' },
      order: { day: 'ASC', order: 'ASC' },
    });
  });
});

describe('ItineraryService.replaceTripItems', () => {
  it('clears existing items then persists new ones with a Date scheduledAt', async () => {
    const { service, repo } = createHarness();

    await service.replaceTripItems('trip-1', [item(), item({ order: 2 })]);

    expect(repo.delete).toHaveBeenCalledWith({ tripId: 'trip-1' });
    // create 는 scheduledAt 을 Date 로 변환해 넘긴다.
    const created = repo.create.mock.calls[0]?.[0];
    expect(created.scheduledAt).toBeInstanceOf(Date);
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(repo.save.mock.calls[0]?.[0]).toHaveLength(2);
  });

  it('deletes then saves in that order (no orphaned rows)', async () => {
    const { service, repo } = createHarness();
    const calls: string[] = [];
    repo.delete.mockImplementation(async () => {
      calls.push('delete');
      return { affected: 1 };
    });
    repo.save.mockImplementation(async (v: any) => {
      calls.push('save');
      return v;
    });

    await service.replaceTripItems('trip-1', [item()]);
    expect(calls).toEqual(['delete', 'save']);
  });
});

describe('ItineraryService.deleteByTrip', () => {
  it('delegates to a scoped delete', async () => {
    const { service, repo } = createHarness();
    await service.deleteByTrip('trip-1');
    expect(repo.delete).toHaveBeenCalledWith({ tripId: 'trip-1' });
  });
});
