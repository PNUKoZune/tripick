/// <reference types="jest" />

import { ServiceUnavailableException } from '@nestjs/common';
import { TripsService } from '../../src/trips/trips.service';

const dto = {
  title: '부산 그룹 여행',
  destination: '부산',
  startDate: '2026-09-10',
  endDate: '2026-09-11',
  wakeTime: '08:00',
  sleepTime: '23:00',
};

function setup() {
  const saved = { id: 'trip-1', userId: 'owner', ...dto, status: 'confirmed' };
  const repo = {
    create: jest.fn((value: object) => ({ id: 'trip-1', ...value })),
    save: jest.fn().mockResolvedValue(saved),
    findOneBy: jest.fn().mockResolvedValue(saved),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const tripDaysRepo = { save: jest.fn(), create: jest.fn((value: object) => value) };
  const membersRepo = { find: jest.fn() };
  const planner = { generateItinerary: jest.fn().mockResolvedValue([]) };
  const service = new TripsService(
    repo as never,
    tripDaysRepo as never,
    membersRepo as never,
    planner as never,
  );
  return { service, repo, planner };
}

describe('TripsService.create generation hook', () => {
  it('stores accepted draft members before initial itinerary generation', async () => {
    const { service, planner } = setup();
    const order: string[] = [];
    planner.generateItinerary.mockImplementation(async () => {
      order.push('generate');
      return [];
    });

    await service.create('owner', dto, async (trip) => {
      expect(trip.id).toBe('trip-1');
      order.push('members');
    });

    expect(order).toEqual(['members', 'generate']);
  });

  it('rolls back the trip when member preparation fails before generation', async () => {
    const { service, repo, planner } = setup();

    await expect(
      service.create('owner', dto, async () => {
        throw new Error('member write failed');
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(planner.generateItinerary).not.toHaveBeenCalled();
    expect(repo.delete).toHaveBeenCalledWith('trip-1');
  });
});
