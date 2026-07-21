/// <reference types="jest" />

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ScheduleChangeService } from '../../src/schedule-change/schedule-change.service';
import type { ScheduleChangePayload } from '@tripick/types';

/**
 * ScheduleChangeService 단위 테스트.
 * - propose: 비-owner 만 허용(owner 는 BadRequest), owner 에게 승인 요청 알림
 * - approve: kind 별로 기존 서비스 메서드 재실행 + 요청자 결과 알림 + owner 카드 정리
 * - reject/cancel: 상태 전이·권한·뒷정리
 * 의존 서비스는 모두 스파이로 대체한다(Nest DI 미사용).
 */
function setup(opts: { proposal?: Record<string, unknown> } = {}) {
  const savedRows: Record<string, unknown>[] = [];
  const repo = {
    create: jest.fn().mockImplementation((e) => ({ ...e })),
    save: jest.fn().mockImplementation(async (e) => {
      const row = { id: e.id ?? 'p1', createdAt: new Date('2026-07-21T00:00:00Z'), ...e };
      savedRows.push(row);
      return row;
    }),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(opts.proposal ?? null),
  };

  const tripsService = {
    // owner = 'owner', 조회자 접근 허용
    findOneForViewer: jest.fn().mockResolvedValue({ id: 'trip-1', userId: 'owner' }),
    findOne: jest.fn().mockResolvedValue({ id: 'trip-1', userId: 'owner' }),
  };

  const mainPlannerService = {
    findItemLabel: jest.fn().mockResolvedValue({ name: '불국사', day: 1 }),
    addItem: jest.fn().mockResolvedValue({}),
    updateItem: jest.fn().mockResolvedValue({}),
    deleteItem: jest.fn().mockResolvedValue(undefined),
    reorderItems: jest.fn().mockResolvedValue(undefined),
    swap: jest.fn().mockResolvedValue({}),
  };

  const replanningService = { enqueue: jest.fn().mockResolvedValue({ jobId: 'j1' }) };

  const inboxService = {
    create: jest.fn().mockResolvedValue(null),
    cancelScheduleChangeRequest: jest.fn().mockResolvedValue(undefined),
  };

  const service = new ScheduleChangeService(
    repo as never,
    tripsService as never,
    mainPlannerService as never,
    replanningService as never,
    inboxService as never,
  );

  return { service, repo, tripsService, mainPlannerService, replanningService, inboxService, savedRows };
}

const owner = { id: 'owner', nickname: '주인' } as never;
const member = { id: 'member', nickname: '민수' } as never;

function proposal(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'p1',
    tripId: 'trip-1',
    requesterId: 'member',
    kind: 'add_item',
    payload: { kind: 'add_item', body: { day: 2, name: '성산일출봉', scheduledAt: '10:00' } },
    summary: '2일차에 "성산일출봉" 추가',
    status: 'pending',
    day: 2,
    targetItemId: null,
    resolvedAt: null,
    createdAt: new Date('2026-07-21T00:00:00Z'),
    requester: { id: 'member', nickname: '민수' },
    ...over,
  };
}

describe('ScheduleChangeService.propose', () => {
  const addPayload: ScheduleChangePayload = {
    kind: 'add_item',
    body: { day: 2, name: '성산일출봉', scheduledAt: '10:00' },
  };

  it('비-owner 제안을 저장하고 owner 에게 승인 요청 알림을 보낸다', async () => {
    const { service, repo, inboxService } = setup();

    const dto = await service.propose(member, { tripId: 'trip-1', payload: addPayload });

    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(dto.summary).toBe('2일차에 "성산일출봉" 추가');
    expect(dto.status).toBe('pending');
    expect(dto.day).toBe(2);
    expect(dto.requester.nickname).toBe('민수');
    const call = inboxService.create.mock.calls[0][0];
    expect(call.userId).toBe('owner');
    expect(call.category).toBe('schedule_change_request');
    expect(call.payload.proposalId).toBe('p1');
    expect(call.payload.tripId).toBe('trip-1');
  });

  it('owner 가 제안 경로를 쓰면 BadRequest', async () => {
    const { service, tripsService } = setup();
    tripsService.findOneForViewer.mockResolvedValue({ id: 'trip-1', userId: 'owner' });

    await expect(
      service.propose(owner, { tripId: 'trip-1', payload: addPayload }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('swap 제안 요약에 대상 항목명과 새 장소명을 담는다', async () => {
    const { service } = setup();
    const dto = await service.propose(member, {
      tripId: 'trip-1',
      payload: {
        kind: 'swap',
        body: { itemId: 'i1', place: { name: '카페한라', lat: 33.4, lng: 126.5 } },
      },
    });
    expect(dto.summary).toBe('"불국사" → "카페한라" 대안 변경');
    expect(dto.targetItemId).toBe('i1');
  });
});

describe('ScheduleChangeService.approve', () => {
  it('add_item 을 owner 권한으로 재실행하고 요청자에게 결과 알림·owner 카드 정리', async () => {
    const { service, mainPlannerService, inboxService, repo } = setup({ proposal: proposal() });

    const dto = await service.approve(owner, 'p1');

    expect(mainPlannerService.addItem).toHaveBeenCalledWith(owner, 'trip-1', {
      day: 2,
      name: '성산일출봉',
      scheduledAt: '10:00',
    });
    expect(dto.status).toBe('approved');
    expect(repo.save).toHaveBeenCalled();
    expect(inboxService.cancelScheduleChangeRequest).toHaveBeenCalledWith('owner', 'p1');
    const resultNotif = inboxService.create.mock.calls[0][0];
    expect(resultNotif.userId).toBe('member');
    expect(resultNotif.category).toBe('schedule_change_result');
    expect(resultNotif.title).toContain('반영');
  });

  it('swap / delete / reorder / update / replan 을 kind 별 메서드로 분기한다', async () => {
    const cases: Array<{ payload: ScheduleChangePayload; assert: (m: any, r: any) => void }> = [
      {
        payload: { kind: 'swap', body: { itemId: 'i1', place: { name: 'x', lat: 1, lng: 2 } } },
        assert: (m) => expect(m.swap).toHaveBeenCalledWith(owner, 'trip-1', expect.any(Object)),
      },
      {
        payload: { kind: 'delete_item', itemId: 'i2' },
        assert: (m) => expect(m.deleteItem).toHaveBeenCalledWith(owner, 'trip-1', 'i2'),
      },
      {
        payload: { kind: 'reorder_items', body: { day: 1, orderedItemIds: ['a', 'b'] } },
        assert: (m) => expect(m.reorderItems).toHaveBeenCalledWith(owner, 'trip-1', expect.any(Object)),
      },
      {
        payload: { kind: 'update_item', itemId: 'i3', body: { memo: '메모' } },
        assert: (m) => expect(m.updateItem).toHaveBeenCalledWith(owner, 'trip-1', 'i3', { memo: '메모' }),
      },
      {
        payload: { kind: 'replan', body: { trigger: 'manual', note: '조용한 곳' } },
        assert: (_m, r) =>
          expect(r.enqueue).toHaveBeenCalledWith('owner', {
            trigger: 'manual',
            note: '조용한 곳',
            tripId: 'trip-1',
          }),
      },
    ];

    for (const c of cases) {
      const { service, mainPlannerService, replanningService } = setup({
        proposal: proposal({ kind: c.payload.kind, payload: c.payload }),
      });
      await service.approve(owner, 'p1');
      c.assert(mainPlannerService, replanningService);
    }
  });

  it('owner 가 아니면 findOne 이 던진 Forbidden 을 전파한다', async () => {
    const { service, tripsService } = setup({ proposal: proposal() });
    tripsService.findOne.mockRejectedValue(new ForbiddenException());
    await expect(service.approve(member, 'p1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('이미 처리된 제안은 BadRequest', async () => {
    const { service } = setup({ proposal: proposal({ status: 'approved' }) });
    await expect(service.approve(owner, 'p1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('재실행이 실패하면 failed 로 표시하고 실패 알림 후 BadRequest 로 전환한다', async () => {
    const { service, mainPlannerService, inboxService, repo } = setup({ proposal: proposal() });
    mainPlannerService.addItem.mockRejectedValue(new Error('사라진 항목'));

    await expect(service.approve(owner, 'p1')).rejects.toBeInstanceOf(BadRequestException);

    const savedStatuses = repo.save.mock.calls.map((c) => (c[0] as { status: string }).status);
    expect(savedStatuses).toContain('failed');
    expect(inboxService.cancelScheduleChangeRequest).toHaveBeenCalledWith('owner', 'p1');
    const notif = inboxService.create.mock.calls[0][0];
    expect(notif.userId).toBe('member');
    expect(notif.title).toContain('반영하지 못');
  });
});

describe('ScheduleChangeService.reject / cancel', () => {
  it('reject 는 rejected 로 전이하고 요청자에게 거절 알림·owner 카드 정리', async () => {
    const { service, inboxService, repo } = setup({ proposal: proposal() });

    const dto = await service.reject(owner, 'p1');

    expect(dto.status).toBe('rejected');
    expect(repo.save).toHaveBeenCalled();
    expect(inboxService.cancelScheduleChangeRequest).toHaveBeenCalledWith('owner', 'p1');
    expect(inboxService.create.mock.calls[0][0].title).toContain('거절');
  });

  it('cancel 은 요청자 본인만 가능하고 owner 카드를 정리한다', async () => {
    const { service, inboxService, repo } = setup({ proposal: proposal() });

    await service.cancel(member, 'p1');

    const saved = repo.save.mock.calls[0][0] as { status: string };
    expect(saved.status).toBe('cancelled');
    expect(inboxService.cancelScheduleChangeRequest).toHaveBeenCalledWith('owner', 'p1');
  });

  it('요청자가 아니면 cancel 은 Forbidden', async () => {
    const { service } = setup({ proposal: proposal() });
    await expect(service.cancel({ id: 'other' } as never, 'p1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
