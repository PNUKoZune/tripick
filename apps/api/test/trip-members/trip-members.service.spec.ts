/// <reference types="jest" />

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TripMembersService } from '../../src/trip-members/trip-members.service';

/**
 * 인가·초대 수명주기 커버리지.
 * canAccessTrip(접근 판정)·assertTripOwner(owner 게이트)·remove(소켓 eviction·초대 취소 알림)·
 * accept/rejectInvite(본인 초대 검증)·getNotificationTargets(수신자 집계)를 검증한다.
 */
function setup() {
  const membersRepo = {
    findOneBy: jest.fn(),
    find: jest.fn(async () => [] as unknown[]),
    count: jest.fn(async () => 0),
    create: jest.fn((v: unknown) => v),
    save: jest.fn(async (v: unknown) => v),
    remove: jest.fn(async () => undefined),
  };
  const tripsRepo = { findOneBy: jest.fn() };
  const preferencesService = { findByUser: jest.fn(async () => null), getPreferenceVector: jest.fn() };
  const realtimeGateway = { evictFromTrip: jest.fn(async () => undefined) };
  const inboxService = {
    clearTripInvite: jest.fn(async () => undefined),
    cancelTripInvite: jest.fn(async () => undefined),
  };
  const service = new TripMembersService(
    membersRepo as never,
    tripsRepo as never,
    preferencesService as never,
    realtimeGateway as never,
    inboxService as never,
  );
  return { service, membersRepo, tripsRepo, realtimeGateway, inboxService };
}

const now = new Date('2026-07-20T00:00:00.000Z');
function member(over: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    tripId: 'trip-1',
    userId: 'guest',
    friendId: null,
    nickname: '게스트',
    role: 'companion',
    status: 'accepted',
    color: '#3182F6',
    preferenceTags: undefined,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

describe('TripMembersService.canAccessTrip', () => {
  it('여행이 없으면 false', async () => {
    const { service, tripsRepo } = setup();
    tripsRepo.findOneBy.mockResolvedValue(null);
    await expect(service.canAccessTrip('trip-1', 'u1')).resolves.toBe(false);
  });

  it('owner 면 멤버 조회 없이 true', async () => {
    const { service, tripsRepo, membersRepo } = setup();
    tripsRepo.findOneBy.mockResolvedValue({ id: 'trip-1', userId: 'u1' });
    await expect(service.canAccessTrip('trip-1', 'u1')).resolves.toBe(true);
    expect(membersRepo.findOneBy).not.toHaveBeenCalled();
  });

  it('accepted 멤버면 true', async () => {
    const { service, tripsRepo, membersRepo } = setup();
    tripsRepo.findOneBy.mockResolvedValue({ id: 'trip-1', userId: 'owner' });
    membersRepo.findOneBy.mockResolvedValue(member({ userId: 'u1' }));
    await expect(service.canAccessTrip('trip-1', 'u1')).resolves.toBe(true);
    expect(membersRepo.findOneBy).toHaveBeenCalledWith({ tripId: 'trip-1', userId: 'u1', status: 'accepted' });
  });

  it('accepted 멤버가 아니면 false', async () => {
    const { service, tripsRepo, membersRepo } = setup();
    tripsRepo.findOneBy.mockResolvedValue({ id: 'trip-1', userId: 'owner' });
    membersRepo.findOneBy.mockResolvedValue(null);
    await expect(service.canAccessTrip('trip-1', 'u1')).resolves.toBe(false);
  });
});

describe('TripMembersService.remove', () => {
  it('owner 가 아니면 ForbiddenException', async () => {
    const { service, tripsRepo } = setup();
    tripsRepo.findOneBy.mockResolvedValue({ id: 'trip-1', userId: 'someone-else' });
    await expect(service.remove('trip-1', 'm1', 'u1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('멤버가 없으면 NotFoundException', async () => {
    const { service, tripsRepo, membersRepo } = setup();
    tripsRepo.findOneBy.mockResolvedValue({ id: 'trip-1', userId: 'u1' });
    membersRepo.findOneBy.mockResolvedValue(null);
    await expect(service.remove('trip-1', 'm1', 'u1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('owner 멤버는 제거할 수 없다(BadRequest)', async () => {
    const { service, tripsRepo, membersRepo } = setup();
    tripsRepo.findOneBy.mockResolvedValue({ id: 'trip-1', userId: 'u1' });
    membersRepo.findOneBy.mockResolvedValue(member({ role: 'owner', userId: 'u1' }));
    await expect(service.remove('trip-1', 'm1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepted 멤버 제거 시 소켓을 즉시 eviction 한다', async () => {
    const { service, tripsRepo, membersRepo, realtimeGateway, inboxService } = setup();
    tripsRepo.findOneBy.mockResolvedValue({ id: 'trip-1', userId: 'u1' });
    membersRepo.findOneBy.mockResolvedValue(member({ status: 'accepted', userId: 'guest' }));

    await service.remove('trip-1', 'm1', 'u1');

    expect(membersRepo.remove).toHaveBeenCalled();
    expect(realtimeGateway.evictFromTrip).toHaveBeenCalledWith('trip-1', 'guest');
    // accepted(pending 아님) 취소이므로 초대 취소 알림은 없다.
    expect(inboxService.cancelTripInvite).not.toHaveBeenCalled();
  });

  it('pending 초대 취소 시 invitee 에게 취소 알림을 보낸다', async () => {
    const { service, tripsRepo, membersRepo, inboxService } = setup();
    tripsRepo.findOneBy.mockResolvedValue({ id: 'trip-1', userId: 'u1', title: '부산 여행' });
    membersRepo.findOneBy.mockResolvedValue(member({ status: 'pending', userId: 'invitee' }));

    await service.remove('trip-1', 'm1', 'u1');

    expect(inboxService.cancelTripInvite).toHaveBeenCalledWith({
      userId: 'invitee',
      tripMemberId: 'm1',
      tripTitle: '부산 여행',
    });
  });
});

describe('TripMembersService.acceptInvite / rejectInvite', () => {
  it('본인에게 온 초대가 아니면 accept 는 Forbidden', async () => {
    const { service, membersRepo } = setup();
    membersRepo.findOneBy.mockResolvedValue(member({ userId: 'other' }));
    await expect(
      service.acceptInvite('trip-1', 'm1', { id: 'u1', nickname: '나' } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('이미 accepted 면 저장 없이 그대로 돌려준다(멱등)', async () => {
    const { service, membersRepo } = setup();
    membersRepo.findOneBy.mockResolvedValue(member({ userId: 'u1', status: 'accepted' }));
    const dto = await service.acceptInvite('trip-1', 'm1', { id: 'u1', nickname: '나' } as never);
    expect(dto.status).toBe('accepted');
    expect(membersRepo.save).not.toHaveBeenCalled();
  });

  it('수락하면 accepted 로 바꾸고 초대 카드를 정리한다', async () => {
    const { service, membersRepo, inboxService } = setup();
    membersRepo.findOneBy.mockResolvedValue(member({ userId: 'u1', status: 'pending' }));
    const dto = await service.acceptInvite('trip-1', 'm1', { id: 'u1', nickname: '수락자' } as never);
    expect(dto.status).toBe('accepted');
    expect(dto.nickname).toBe('수락자');
    expect(membersRepo.save).toHaveBeenCalled();
    expect(inboxService.clearTripInvite).toHaveBeenCalledWith('u1', 'm1');
  });

  it('owner 멤버는 거절할 수 없다(BadRequest)', async () => {
    const { service, membersRepo } = setup();
    membersRepo.findOneBy.mockResolvedValue(member({ userId: 'u1', role: 'owner' }));
    await expect(
      service.rejectInvite('trip-1', 'm1', { id: 'u1', nickname: '나' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('거절하면 멤버를 삭제하고 초대 카드를 정리한다', async () => {
    const { service, membersRepo, inboxService } = setup();
    membersRepo.findOneBy.mockResolvedValue(member({ userId: 'u1', status: 'pending', role: 'companion' }));
    await service.rejectInvite('trip-1', 'm1', { id: 'u1', nickname: '나' } as never);
    expect(membersRepo.remove).toHaveBeenCalled();
    expect(inboxService.clearTripInvite).toHaveBeenCalledWith('u1', 'm1');
  });
});

describe('TripMembersService.getNotificationTargets', () => {
  it('여행이 없으면 빈 결과', async () => {
    const { service, tripsRepo } = setup();
    tripsRepo.findOneBy.mockResolvedValue(null);
    await expect(service.getNotificationTargets('trip-1')).resolves.toEqual({ tripTitle: '', userIds: [] });
  });

  it('owner + accepted 멤버(userId 있는)만 중복 없이 모은다', async () => {
    const { service, tripsRepo, membersRepo } = setup();
    tripsRepo.findOneBy.mockResolvedValue({ id: 'trip-1', userId: 'owner', title: '여행' });
    membersRepo.find.mockResolvedValue([
      member({ userId: 'guest-a' }),
      member({ userId: null }), // 핸들만 등록(계정 없음) → 제외
      member({ userId: 'owner' }), // owner 와 중복 → 한 번만
    ]);

    const res = await service.getNotificationTargets('trip-1');

    expect(res.tripTitle).toBe('여행');
    expect(res.userIds.sort()).toEqual(['guest-a', 'owner']);
  });
});
