/// <reference types="jest" />

import { InboxService } from './inbox.service';
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
