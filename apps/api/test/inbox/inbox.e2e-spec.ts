/// <reference types="jest" />

import type { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import request from 'supertest';
import type { InboxSummaryDto } from '@tripick/types';
import { createE2EApp, TestAuthGuard } from '../e2e/create-e2e-app';
import { UserEntity } from '../../src/users/user.entity';
import { NotificationEntity } from '../../src/inbox/notification.entity';
import { FriendEntity } from '../../src/friends/friend.entity';
import { InboxController } from '../../src/inbox/inbox.controller';
import { InboxService } from '../../src/inbox/inbox.service';
import { UsersService } from '../../src/users/users.service';
import { NotificationService } from '../../src/notification/notification.service';
import { JwtAuthGuard } from '../../src/auth/guards/jwt-auth.guard';

describe('Inbox (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let users: Repository<UserEntity>;
  let notifications: Repository<NotificationEntity>;
  let friends: Repository<FriendEntity>;

  beforeAll(async () => {
    app = await createE2EApp({
      entities: [UserEntity, NotificationEntity, FriendEntity],
      controllers: [InboxController],
      providers: [
        InboxService,
        // list/markRead/markAllRead 는 이 둘을 쓰지 않지만 DI 충족을 위해 스텁 제공.
        { provide: UsersService, useValue: { findById: jest.fn(), prefersCategory: jest.fn() } },
        { provide: NotificationService, useValue: { sendToUser: jest.fn() } },
      ],
      overrideGuards: [{ guard: JwtAuthGuard, useValue: TestAuthGuard }],
    });
    http = request(app.getHttpServer());
    users = app.get(getRepositoryToken(UserEntity));
    notifications = app.get(getRepositoryToken(NotificationEntity));
    friends = app.get(getRepositoryToken(FriendEntity));
  });

  afterAll(async () => {
    await app?.close();
  });

  let seq = 0;
  const newUser = async () => (await users.save(users.create({ nickname: `유저${seq++}` }))).id;

  const seedNotification = (userId: string, over: Partial<NotificationEntity> = {}) =>
    notifications.save(
      notifications.create({
        userId,
        category: 'general',
        title: '알림',
        body: '본문',
        payload: null,
        readAt: null,
        ...over,
      }),
    );

  const seedIncomingFriend = (ownerId: string, nickname: string) =>
    friends.save(
      friends.create({
        ownerId,
        friendUserId: null,
        nickname,
        handle: `@${nickname}`,
        color: '#3182F6',
        initial: nickname[0]!,
        status: 'incoming',
        pinned: false,
        statusMessage: '친구 요청을 보냈어요.',
      }),
    );

  describe('GET /inbox', () => {
    it('merges incoming friend requests with notifications and counts unread', async () => {
      const uid = await newUser();
      await seedNotification(uid, { title: '읽음', readAt: new Date() });
      await seedNotification(uid, { title: '안읽음' });
      await seedIncomingFriend(uid, '캐롤');

      const res = await http.get('/inbox').set('x-test-user-id', uid).expect(200);
      const body = res.body as InboxSummaryDto;

      expect(body.items).toHaveLength(3);
      expect(body.items.some((i) => i.kind === 'friend_request')).toBe(true);
      // 안읽은 알림 1 + incoming 친구요청 1 = 2
      expect(body.unreadCount).toBe(2);
    });

    it('returns an empty inbox for a user with no activity', async () => {
      const uid = await newUser();
      const res = await http.get('/inbox').set('x-test-user-id', uid).expect(200);
      expect(res.body).toEqual({ items: [], unreadCount: 0 });
    });
  });

  describe('PATCH /inbox/:id/read', () => {
    it('marks a notification read for its owner', async () => {
      const uid = await newUser();
      const n = await seedNotification(uid);
      const res = await http.patch(`/inbox/${n.id}/read`).set('x-test-user-id', uid).expect(200);
      expect(res.body.readAt).not.toBeNull();

      const reloaded = await notifications.findOneBy({ id: n.id });
      expect(reloaded?.readAt).toBeInstanceOf(Date);
    });

    it('returns 404 for a missing notification', async () => {
      const uid = await newUser();
      await http
        .patch('/inbox/00000000-0000-4000-8000-000000000000/read')
        .set('x-test-user-id', uid)
        .expect(404);
    });

    it('forbids marking another user’s notification (403)', async () => {
      const owner = await newUser();
      const intruder = await newUser();
      const n = await seedNotification(owner);
      await http.patch(`/inbox/${n.id}/read`).set('x-test-user-id', intruder).expect(403);
    });
  });

  describe('POST /inbox/read-all', () => {
    it('marks every unread notification read and reports the count', async () => {
      const uid = await newUser();
      await seedNotification(uid);
      await seedNotification(uid);
      await seedNotification(uid, { readAt: new Date() }); // 이미 읽음 → 대상 아님

      const res = await http.post('/inbox/read-all').set('x-test-user-id', uid).expect(200);
      expect(res.body.updated).toBe(2);

      const after = await http.get('/inbox').set('x-test-user-id', uid).expect(200);
      expect((after.body as InboxSummaryDto).unreadCount).toBe(0);
    });
  });
});
