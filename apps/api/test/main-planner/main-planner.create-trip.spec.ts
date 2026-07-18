/// <reference types="jest" />

import { BadRequestException } from '@nestjs/common';
import { MainPlannerService } from '../../src/main-planner/main-planner.service';
import type { CreateTripRequestDto } from '@tripick/types';

function validDto(over: Partial<CreateTripRequestDto> = {}): CreateTripRequestDto {
  return {
    title: '부산 여행',
    destination: '부산',
    startDate: '2026-07-10',
    startTime: '09:00',
    endDate: '2026-07-11',
    endTime: '21:00',
    members: [],
    ...over,
  };
}

function createHarness() {
  const tripsService = {
    create: jest.fn(async (_userId: string, dto: any) => ({
      id: 'trip-1',
      userId: 'u1',
      title: dto.title,
      destination: dto.destination,
      startDate: dto.startDate,
      endDate: dto.endDate,
      status: 'confirmed',
      notes: dto.notes ?? null,
      transportMode: dto.transportMode,
    })),
    findVisible: jest.fn(),
  };
  const tripMembersService = { findAll: jest.fn().mockResolvedValue([]), createFromFriend: jest.fn() };
  const friendsService = { findAcceptedById: jest.fn() };
  const preferencesService = { findByUser: jest.fn().mockResolvedValue(null) };
  const itemsRepo = {
    count: jest.fn().mockResolvedValue(0),
    find: jest.fn().mockResolvedValue([]),
  };
  const noop = {} as any;

  const service = new MainPlannerService(
    noop, // tripsRepo
    itemsRepo as any,
    tripsService as any,
    tripMembersService as any,
    friendsService as any,
    preferencesService as any,
    noop, // inboxService
    noop, // weatherHelper
    noop, // kakaoLocal
    noop, // placeRetrieval
    noop, // placeEmbeddings
    noop, // routeHelper
  );
  const user = { id: 'u1', nickname: '앨리스' } as any;
  return { service, tripsService, preferencesService, user };
}

describe('MainPlannerService.createTrip — validation', () => {
  const cases: Array<[string, Partial<CreateTripRequestDto>]> = [
    ['빈 제목', { title: '  ' }],
    ['빈 지역', { destination: '' }],
    ['기간 누락', { startDate: '' }],
    ['시작일이 종료일보다 늦음', { startDate: '2026-07-12', endDate: '2026-07-11' }],
    ['시각 누락', { startTime: '' }],
    ['같은 날 도착이 출발보다 빠름', { startDate: '2026-07-10', endDate: '2026-07-10', startTime: '18:00', endTime: '09:00' }],
  ];

  it.each(cases)('rejects %s with 400', async (_label, override) => {
    const { service, user, tripsService } = createHarness();
    await expect(service.createTrip(user, validDto(override))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tripsService.create).not.toHaveBeenCalled();
  });
});

describe('MainPlannerService.createTrip — success wiring', () => {
  it('applies default wake/sleep, resolves transport, and composes notes', async () => {
    const { service, tripsService, user } = createHarness();

    const summary = await service.createTrip(
      user,
      validDto({ notes: '유아 동반', pace: 'relaxed', budget: 'premium', transportMode: 'car' }),
    );

    expect(tripsService.create).toHaveBeenCalledTimes(1);
    const [, createdDto] = tripsService.create.mock.calls[0]!;
    expect(createdDto).toMatchObject({
      title: '부산 여행',
      destination: '부산',
      wakeTime: '08:00', // preference 없을 때 기본값
      sleepTime: '23:00',
      transportMode: 'car',
    });
    // notes = 사용자 노트 + 강도/예산/이동수단 힌트 병합
    expect(createdDto.notes).toContain('유아 동반');
    expect(createdDto.notes).toContain('여유롭게');
    expect(createdDto.notes).toContain('프리미엄');

    expect(summary).toMatchObject({ id: 'trip-1', destination: '부산', itemCount: 0 });
  });

  it('falls back to transit when no transport is provided', async () => {
    const { service, tripsService, user } = createHarness();
    await service.createTrip(user, validDto());
    const [, createdDto] = tripsService.create.mock.calls[0]!;
    expect(createdDto.transportMode).toBe('transit');
  });
});
