/// <reference types="jest" />

import { InboxService } from './inbox.service';
import type { NotificationEntity } from './notification.entity';
import type { UserEntity } from '../users/user.entity';

/**
 * notifyFriendRequest 의 실시간 토스트 + FCM 발송이 friend_request 수신 토글을 따르는지 검증.
 * 인박스 목록 갱신(pushInboxRefresh)은 토글과 무관하게 항상 쏘므로 여기 대상이 아니다.
 */
describe('InboxService.notifyFriendRequest', () => {
  const requester = { id: 'req-1', nickname: '앨리스' } as UserEntity;
  const recipient = { id: 'rcp-1', nickname: '밥' } as UserEntity;

  function setup(prefers: boolean) {
    const usersService = { prefersCategory: jest.fn().mockReturnValue(prefers) };
    const notificationService = { sendToUser: jest.fn() };
    const realtimeGateway = { pushInboxToast: jest.fn(), pushInboxInvalidate: jest.fn() };
    const service = new InboxService(
      {} as never,
      {} as never,
      usersService as never,
      notificationService as never,
      realtimeGateway as never,
    );
    return { service, usersService, notificationService, realtimeGateway };
  }

  it('토글 on 이면 실시간 토스트와 FCM 을 모두 발송한다', async () => {
    const { service, notificationService, realtimeGateway } = setup(true);

    await service.notifyFriendRequest(recipient, requester);

    expect(realtimeGateway.pushInboxToast).toHaveBeenCalledWith(recipient.id, {
      tone: 'primary',
      title: '새 친구 요청',
      message: '앨리스 님이 친구를 신청했어요.',
      href: '/inbox',
    });
    expect(notificationService.sendToUser).toHaveBeenCalledTimes(1);
  });

  it('토글 off 이면 토스트도 FCM 도 보내지 않는다(no-op)', async () => {
    const { service, notificationService, realtimeGateway } = setup(false);

    await service.notifyFriendRequest(recipient, requester);

    expect(realtimeGateway.pushInboxToast).not.toHaveBeenCalled();
    expect(notificationService.sendToUser).not.toHaveBeenCalled();
  });
});

/**
 * 수신 토글이 푸시(FCM)만 막고 인박스 row 는 항상 남기는지 검증.
 * 끄면 저장조차 안 하던 동작을 바꾼 것이라 "저장은 됐는가"가 이 스위트의 핵심이다.
 * 목록 갱신(pushInboxInvalidate)은 화면 최신화라 토글과 무관하게 항상 쏜다.
 */
describe('InboxService.create 수신 토글', () => {
  const receiver = { id: 'usr-1' } as UserEntity;

  function setup(prefers: boolean) {
    const notificationsRepo = {
      create: jest.fn((entity: Partial<NotificationEntity>) => entity),
      save: jest.fn(async (entity: Partial<NotificationEntity>) => ({ id: 'n-1', ...entity })),
    };
    const usersService = {
      findById: jest.fn().mockResolvedValue(receiver),
      prefersCategory: jest.fn().mockReturnValue(prefers),
    };
    const notificationService = { sendToUser: jest.fn() };
    const realtimeGateway = { pushInboxToast: jest.fn(), pushInboxInvalidate: jest.fn() };
    const service = new InboxService(
      notificationsRepo as never,
      {} as never,
      usersService as never,
      notificationService as never,
      realtimeGateway as never,
    );
    return { service, notificationsRepo, notificationService, realtimeGateway };
  }

  const dto = {
    userId: receiver.id,
    category: 'general',
    title: '안내',
    body: '본문',
  } as const;

  it('토글 on 이면 저장·푸시·목록 갱신을 모두 한다', async () => {
    const { service, notificationsRepo, notificationService, realtimeGateway } = setup(true);

    const saved = await service.create({ ...dto });

    expect(notificationsRepo.save).toHaveBeenCalledTimes(1);
    expect(saved.readAt).toBeNull();
    expect(notificationService.sendToUser).toHaveBeenCalledTimes(1);
    expect(realtimeGateway.pushInboxInvalidate).toHaveBeenCalledWith(receiver.id);
  });

  it('토글 off 여도 인박스에는 저장하고 푸시만 건너뛴다', async () => {
    const { service, notificationsRepo, notificationService, realtimeGateway } = setup(false);

    await service.create({ ...dto });

    expect(notificationsRepo.save).toHaveBeenCalledTimes(1);
    expect(notificationService.sendToUser).not.toHaveBeenCalled();
    expect(realtimeGateway.pushInboxInvalidate).toHaveBeenCalledWith(receiver.id);
  });

  it('토글 off 로 저장한 알림은 읽음으로 찍혀 안 읽음 배지를 올리지 않는다', async () => {
    const { service } = setup(false);

    const saved = await service.create({ ...dto });

    expect(saved.readAt).toBeInstanceOf(Date);
  });
});

/**
 * 인박스 '응답 필요' 필터가 딥링크 알림까지 다 잡던 회귀 방지.
 * 판정 정본은 서버가 실어 보내는 requiresResponse 이고, open-* 은 내비게이션이라 false 다.
 */
describe('InboxService 액션 requiresResponse', () => {
  const service = new InboxService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  function notification(
    category: NotificationEntity['category'],
    payload: Record<string, string>,
  ): NotificationEntity {
    return {
      id: 'n-1',
      category,
      title: '제목',
      body: '본문',
      payload,
      createdAt: new Date('2026-08-04T00:00:00Z'),
      readAt: null,
    } as NotificationEntity;
  }

  it('여행 초대의 수락·거절은 응답 대기다', () => {
    const item = service['fromNotification'](
      notification('trip_invite', { tripId: 't-1', tripMemberId: 'm-1' }),
    );

    expect(item.actions.map((a) => [a.type, a.requiresResponse])).toEqual([
      ['accept-trip-invite', true],
      ['reject-trip-invite', true],
    ]);
  });

  it('미도착 알림의 일정 변경 딥링크는 응답 대기가 아니다', () => {
    const item = service['fromNotification'](
      notification('arrival_alert', { tripId: 't-1', day: '2' }),
    );

    expect(item.actions).toHaveLength(1);
    expect(item.actions[0]).toMatchObject({ type: 'open-trip', requiresResponse: false });
  });

  it('친구 요청 가상 row 도 응답 대기로 표시된다', () => {
    const item = service['fromFriend']({
      id: 'f-1',
      nickname: '앨리스',
      handle: '@alice',
      statusMessage: null,
      createdAt: new Date('2026-08-04T00:00:00Z'),
    } as never);

    expect(item.actions.every((a) => a.requiresResponse)).toBe(true);
  });
});
