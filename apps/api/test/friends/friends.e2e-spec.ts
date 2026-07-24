/// <reference types="jest" />

import type { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import request from 'supertest';
import type { FriendDto } from '@tripick/types';
import { createE2EApp, TestAuthGuard } from '../e2e/create-e2e-app';
import { UserEntity } from '../../src/users/user.entity';
import { FriendEntity } from '../../src/friends/friend.entity';
import { FriendsController } from '../../src/friends/friends.controller';
import { FriendsService } from '../../src/friends/friends.service';
import { InboxService } from '../../src/inbox/inbox.service';
import { JwtAuthGuard } from '../../src/auth/guards/jwt-auth.guard';

describe('Friends (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let alice: string;
  let bob: string;
  const notifyFriendRequest = jest.fn().mockResolvedValue(undefined);
  const pushInboxRefresh = jest.fn();

  beforeAll(async () => {
    app = await createE2EApp({
      entities: [UserEntity, FriendEntity],
      controllers: [FriendsController],
      providers: [
        FriendsService,
        { provide: InboxService, useValue: { notifyFriendRequest, pushInboxRefresh } },
      ],
      overrideGuards: [{ guard: JwtAuthGuard, useValue: TestAuthGuard }],
    });
    http = request(app.getHttpServer());

    const users = app.get<Repository<UserEntity>>(getRepositoryToken(UserEntity));
    alice = (await users.save(users.create({ nickname: '앨리스', handle: 'alice' }))).id;
    bob = (await users.save(users.create({ nickname: '밥', handle: 'bob' }))).id;
  });

  afterAll(async () => {
    await app?.close();
  });

  const list = async (userId: string): Promise<FriendDto[]> =>
    (await http.get('/friends').set('x-test-user-id', userId).expect(200)).body;

  const registerUser = async (nickname: string, handle: string): Promise<string> => {
    const users = app.get<Repository<UserEntity>>(getRepositoryToken(UserEntity));
    return (await users.save(users.create({ nickname, handle }))).id;
  };

  describe('POST /friends', () => {
    it('adding a registered user creates a pending link and an incoming request on the other side', async () => {
      notifyFriendRequest.mockClear();
      pushInboxRefresh.mockClear();
      const res = await http.post('/friends').set('x-test-user-id', alice).send({ handle: '@bob' }).expect(201);
      expect(res.body).toMatchObject({ handle: '@bob', status: 'pending' });

      // 상대(bob)에게는 incoming 요청이 생성돼 있어야 한다.
      const bobFriends = await list(bob);
      const fromAlice = bobFriends.find((f) => f.status === 'incoming');
      expect(fromAlice).toBeDefined();
      expect(fromAlice?.nickname).toBe('앨리스');

      // 신규 incoming 요청이 생기면 수신자(bob)에게 푸시가 발송돼야 한다.
      expect(notifyFriendRequest).toHaveBeenCalledTimes(1);
      const [recipient, requester] = notifyFriendRequest.mock.calls[0];
      expect(recipient.id).toBe(bob);
      expect(requester.id).toBe(alice);

      // 푸시 토글과 무관하게 수신자(bob) 인박스 목록 실시간 갱신 신호도 쏴야 한다.
      expect(pushInboxRefresh).toHaveBeenCalledWith(bob);
    });

    it('rejects an unregistered handle (404)', async () => {
      await http
        .post('/friends')
        .set('x-test-user-id', alice)
        .send({ handle: '@ghost' })
        .expect(404);
    });

    it('rejects adding yourself (400)', async () => {
      await http.post('/friends').set('x-test-user-id', alice).send({ handle: '@alice' }).expect(400);
    });

    it('rejects a duplicate friend (409)', async () => {
      await registerUser('듀프', 'dupe');
      await http.post('/friends').set('x-test-user-id', bob).send({ handle: '@dupe' }).expect(201);
      await http.post('/friends').set('x-test-user-id', bob).send({ handle: '@dupe' }).expect(409);
    });
  });

  describe('PATCH /friends/:id/accept', () => {
    it('accepting an incoming request promotes both sides to accepted', async () => {
      // carol ↔ bob 로 독립 시나리오 구성
      const users = app.get<Repository<UserEntity>>(getRepositoryToken(UserEntity));
      const carol = (await users.save(users.create({ nickname: '캐롤', handle: 'carol' }))).id;

      await http.post('/friends').set('x-test-user-id', carol).send({ handle: '@bob' }).expect(201);
      const incoming = (await list(bob)).find((f) => f.status === 'incoming' && f.nickname === '캐롤');
      expect(incoming).toBeDefined();

      const accepted = await http
        .patch(`/friends/${incoming!.id}/accept`)
        .set('x-test-user-id', bob)
        .expect(200);
      expect(accepted.body.status).toBe('accepted');

      // carol 쪽 pending 도 accepted 로 승격됐는지 확인
      const carolSide = (await list(carol)).find((f) => f.handle === '@bob');
      expect(carolSide?.status).toBe('accepted');
    });

    it('rejects accepting a non-incoming friend (400)', async () => {
      await registerUser('프랭크', 'frank');
      // bob 이 보낸 요청은 pending — incoming 이 아니라 수락 대상이 아니다.
      const res = await http.post('/friends').set('x-test-user-id', bob).send({ handle: '@frank' }).expect(201);
      expect(res.body.status).toBe('pending');
      await http.patch(`/friends/${res.body.id}/accept`).set('x-test-user-id', bob).expect(400);
    });
  });

  describe('PATCH /friends/:id/pin & DELETE', () => {
    it('toggles the pinned flag', async () => {
      await registerUser('핀미', 'pinme');
      const res = await http.post('/friends').set('x-test-user-id', alice).send({ handle: '@pinme' }).expect(201);
      const pinned = await http.patch(`/friends/${res.body.id}/pin`).set('x-test-user-id', alice).expect(200);
      expect(pinned.body.pinned).toBe(true);
    });

    it('forbids operating on another user’s friend (403)', async () => {
      await registerUser('마인', 'mine');
      const res = await http.post('/friends').set('x-test-user-id', alice).send({ handle: '@mine' }).expect(201);
      await http.delete(`/friends/${res.body.id}`).set('x-test-user-id', bob).expect(403);
    });

    it('removes an owned friend (204)', async () => {
      await registerUser('바이', 'bye');
      const res = await http.post('/friends').set('x-test-user-id', alice).send({ handle: '@bye' }).expect(201);
      await http.delete(`/friends/${res.body.id}`).set('x-test-user-id', alice).expect(204);
      const remaining = await list(alice);
      expect(remaining.map((f) => f.handle)).not.toContain('@bye');
    });

    it('canceling a sent (pending) request also clears the recipient’s incoming row', async () => {
      // dave → erin 로 독립 시나리오 구성
      const users = app.get<Repository<UserEntity>>(getRepositoryToken(UserEntity));
      const dave = (await users.save(users.create({ nickname: '데이브', handle: 'dave' }))).id;
      const erin = (await users.save(users.create({ nickname: '에린', handle: 'erin' }))).id;

      const sent = await http.post('/friends').set('x-test-user-id', dave).send({ handle: '@erin' }).expect(201);
      expect(sent.body.status).toBe('pending');
      expect((await list(erin)).some((f) => f.status === 'incoming' && f.nickname === '데이브')).toBe(true);

      // dave 가 보낸 요청 취소 → 본인 pending 행과 erin 의 incoming 행이 모두 사라져야 한다.
      pushInboxRefresh.mockClear();
      await http.delete(`/friends/${sent.body.id}`).set('x-test-user-id', dave).expect(204);
      expect((await list(dave)).some((f) => f.handle === '@erin')).toBe(false);
      expect((await list(erin)).some((f) => f.status === 'incoming' && f.nickname === '데이브')).toBe(false);

      // erin 의 남은 incoming 카드가 즉시 사라지도록 갱신 신호를 쏴야 한다.
      expect(pushInboxRefresh).toHaveBeenCalledWith(erin);
    });
  });
});
