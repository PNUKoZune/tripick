/// <reference types="jest" />

import { BadRequestException } from '@nestjs/common';
import { MainPlannerService } from '../../src/main-planner/main-planner.service';
import type { CreateTripDto, CreateTripRequestDto } from '@tripick/types';
import type { TripEntity } from '../../src/trips/trip.entity';

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
    create: jest.fn(async (
      _userId: string,
      dto: CreateTripDto,
      beforeGenerate?: (trip: TripEntity) => Promise<void>,
    ) => {
      const trip = {
        id: 'trip-1',
        userId: 'u1',
        title: dto.title,
        destination: dto.destination,
        startDate: dto.startDate,
        endDate: dto.endDate,
        status: 'confirmed',
        notes: dto.notes ?? null,
        transportMode: dto.transportMode,
      } as TripEntity;
      await beforeGenerate?.(trip);
      return trip;
    }),
    findVisible: jest.fn(),
  };
  const tripMembersService = { findAll: jest.fn().mockResolvedValue([]), createFromFriend: jest.fn() };
  const friendsService = { findAcceptedById: jest.fn() };
  const preferencesService = { findByUser: jest.fn().mockResolvedValue(null) };
  const inboxService = { create: jest.fn().mockResolvedValue(null) };
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
    inboxService as any,
    noop, // weatherHelper
    noop, // kakaoLocal
    noop, // placeRetrieval
    noop, // placeEmbeddings
    noop, // tourApi
    noop, // routeHelper
    noop, // groupPreferences (여행 생성은 TripsService 내부 planner가 사용)
  );
  const user = { id: 'u1', nickname: '앨리스' } as any;
  return { service, tripsService, tripMembersService, friendsService, inboxService, preferencesService, user };
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

describe('MainPlannerService.createTrip — 참여자 초대', () => {
  it('실계정 참여자를 포함해 생성하면 pending 초대(trip_invite)를 보낸다', async () => {
    const { service, friendsService, tripMembersService, inboxService, user } = createHarness();
    friendsService.findAcceptedById.mockResolvedValue({
      id: 'f1',
      friendUserId: 'u2',
      nickname: '밥',
      handle: 'bob',
      color: '#000',
    });
    // 실계정 매칭 → pending 으로 생성됨
    tripMembersService.createFromFriend.mockResolvedValue({
      id: 'tm-1',
      userId: 'u2',
      status: 'pending',
    });

    await service.createTrip(user, validDto({ members: [{ id: 'tm-x', friendId: 'f1' } as any] }));

    expect(inboxService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u2',
        category: 'trip_invite',
        payload: expect.objectContaining({ tripId: 'trip-1', tripMemberId: 'tm-1' }),
      }),
    );
  });

  it('핸들만 등록된(비계정) 참여자는 즉시 accepted 라 초대를 보내지 않는다', async () => {
    const { service, friendsService, tripMembersService, inboxService, user } = createHarness();
    friendsService.findAcceptedById.mockResolvedValue({ id: 'f2', nickname: '캐럴', handle: 'carol' });
    tripMembersService.createFromFriend.mockResolvedValue({
      id: 'tm-2',
      userId: null,
      status: 'accepted',
    });

    await service.createTrip(user, validDto({ members: [{ id: 'tm-y', friendId: 'f2' } as any] }));

    expect(inboxService.create).not.toHaveBeenCalled();
  });

  it('일정 생성이 실패하면 먼저 만든 pending 멤버의 죽은 초대 알림을 남기지 않는다', async () => {
    const { service, tripsService, friendsService, tripMembersService, inboxService, user } =
      createHarness();
    friendsService.findAcceptedById.mockResolvedValue({
      id: 'f1',
      friendUserId: 'u2',
      nickname: '밥',
      handle: 'bob',
      color: '#000',
    });
    tripMembersService.createFromFriend.mockResolvedValue({
      id: 'tm-1',
      userId: 'u2',
      status: 'pending',
    });
    tripsService.create.mockImplementation(async (_userId, _dto, beforeGenerate) => {
      await beforeGenerate?.({ id: 'trip-dead', userId: 'u1' } as TripEntity);
      throw new Error('generation failed');
    });

    await expect(
      service.createTrip(user, validDto({ members: [{ id: 'tm-x', friendId: 'f1' } as never] })),
    ).rejects.toThrow('generation failed');

    expect(tripMembersService.createFromFriend).toHaveBeenCalled();
    expect(inboxService.create).not.toHaveBeenCalled();
  });
});

describe('MainPlannerService.createTrip — 일자별 지역(dayRegions)', () => {
  // validDto: 2026-07-10~07-11 = 2일

  it('dayRegions 길이가 여행 일수와 다르면 400', async () => {
    const { service, user, tripsService } = createHarness();
    await expect(
      service.createTrip(user, validDto({ dayRegions: [['부산']] })), // 2일인데 1개
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tripsService.create).not.toHaveBeenCalled();
  });

  it('일자별 지역 원소가 배열이 아니면(string[] 오전송) 500 아닌 400', async () => {
    const { service, user, tripsService } = createHarness();
    await expect(
      service.createTrip(user, validDto({ dayRegions: ['부산', '경주'] as any })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tripsService.create).not.toHaveBeenCalled();
  });

  it('일자별 지역 안에 문자열 아닌 값이 있으면 400', async () => {
    const { service, user, tripsService } = createHarness();
    await expect(
      service.createTrip(user, validDto({ dayRegions: [['부산'], [123 as any]] })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tripsService.create).not.toHaveBeenCalled();
  });

  it('지역이 비어있는 일차가 있으면 400', async () => {
    const { service, user, tripsService } = createHarness();
    await expect(
      service.createTrip(user, validDto({ dayRegions: [['부산'], []] })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tripsService.create).not.toHaveBeenCalled();
  });

  it('서로 다른 일자별 지역은 정규화되어 create 로 전달된다', async () => {
    const { service, user, tripsService } = createHarness();
    await service.createTrip(
      user,
      validDto({ destination: '부산 · 경주', dayRegions: [['부산', '  '], ['경주']] }),
    );
    const [, createdDto] = tripsService.create.mock.calls[0]!;
    // 공백 지역은 제거되어 전달
    expect(createdDto.dayRegions).toEqual([['부산'], ['경주']]);
  });

  it('모든 날이 같은 단일 지역이면 dayRegions 를 붙이지 않는다(단일 지역 흐름)', async () => {
    const { service, user, tripsService } = createHarness();
    await service.createTrip(user, validDto({ dayRegions: [['부산'], ['부산']] }));
    const [, createdDto] = tripsService.create.mock.calls[0]!;
    expect(createdDto.dayRegions).toBeUndefined();
  });
});
