/// <reference types="jest" />

import type { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import request from 'supertest';
import { createE2EApp, TestAuthGuard } from '../e2e/create-e2e-app';
import { UserEntity } from '../../src/users/user.entity';
import { UsersController } from '../../src/users/users.controller';
import { UsersService } from '../../src/users/users.service';
import { FcmTokenEntity } from '../../src/notification/fcm-token.entity';
import { FcmTokenService } from '../../src/notification/fcm-token.service';
import { StorageService } from '../../src/storage/storage.service';
import { JwtAuthGuard } from '../../src/auth/guards/jwt-auth.guard';

describe('Users (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let users: Repository<UserEntity>;
  let fcmTokens: Repository<FcmTokenEntity>;
  // 스토리지 미설정 상태를 흉내내 업로드 503 경로를 검증한다.
  const storage = {
    isReady: jest.fn().mockReturnValue(false),
    putObject: jest.fn(),
    deleteObject: jest.fn(),
    keyFromPublicUrl: jest.fn().mockReturnValue(null),
  };

  beforeAll(async () => {
    app = await createE2EApp({
      entities: [UserEntity, FcmTokenEntity],
      controllers: [UsersController],
      providers: [
        UsersService,
        FcmTokenService,
        { provide: StorageService, useValue: storage },
      ],
      overrideGuards: [{ guard: JwtAuthGuard, useValue: TestAuthGuard }],
    });
    http = request(app.getHttpServer());
    users = app.get(getRepositoryToken(UserEntity));
    fcmTokens = app.get(getRepositoryToken(FcmTokenEntity));
  });

  afterAll(async () => {
    await app?.close();
  });

  let seq = 0;
  const newUser = async (over: Partial<UserEntity> = {}) =>
    (
      await users.save(
        users.create({ nickname: `유저${seq}`, handle: `user${seq++}`, ...over }),
      )
    ).id;

  describe('GET /users/me', () => {
    it('returns the profile without sensitive columns', async () => {
      const uid = await newUser({ passwordHash: 'secret-hash' });
      const res = await http.get('/users/me').set('x-test-user-id', uid).expect(200);
      expect(res.body.id).toBe(uid);
      expect(res.body).not.toHaveProperty('passwordHash');
      expect(res.body).not.toHaveProperty('pendingPasswordHash');
    });
  });

  describe('PATCH /users/me', () => {
    it('updates a valid nickname', async () => {
      const uid = await newUser();
      const res = await http
        .patch('/users/me')
        .set('x-test-user-id', uid)
        .send({ nickname: '새닉네임' })
        .expect(200);
      expect(res.body.nickname).toBe('새닉네임');
    });

    it('rejects an empty nickname (400)', async () => {
      const uid = await newUser();
      await http.patch('/users/me').set('x-test-user-id', uid).send({ nickname: '  ' }).expect(400);
    });

    it('rejects a nickname over 20 chars (400)', async () => {
      const uid = await newUser();
      await http
        .patch('/users/me')
        .set('x-test-user-id', uid)
        .send({ nickname: 'x'.repeat(21) })
        .expect(400);
    });

    it('rejects an invalid handle format (400)', async () => {
      const uid = await newUser();
      await http.patch('/users/me').set('x-test-user-id', uid).send({ handle: 'AB' }).expect(400);
    });

    it('conflicts on a handle already taken by someone else (409)', async () => {
      await newUser({ handle: 'takenhandle' });
      const uid = await newUser();
      await http
        .patch('/users/me')
        .set('x-test-user-id', uid)
        .send({ handle: 'takenhandle' })
        .expect(409);
    });

    it('accepts a free, valid handle', async () => {
      const uid = await newUser();
      const res = await http
        .patch('/users/me')
        .set('x-test-user-id', uid)
        .send({ handle: 'FreshHandle_1' })
        .expect(200);
      expect(res.body.handle).toBe('freshhandle_1'); // 소문자 정규화
    });
  });

  describe('notification preferences & fcm token', () => {
    it('merges notification preferences over the defaults', async () => {
      const uid = await newUser();
      const res = await http
        .patch('/users/me/notification-preferences')
        .set('x-test-user-id', uid)
        .send({ preferences: { replan_ready: false } })
        .expect(200);
      expect(res.body.replan_ready).toBe(false);
    });

    it('registers an fcm token into the token table', async () => {
      const uid = await newUser();
      const res = await http
        .patch('/users/me/fcm-token')
        .set('x-test-user-id', uid)
        .send({ fcmToken: 'new-device-token', platform: 'android' })
        .expect(200);
      expect(res.body).toEqual({ success: true });

      const saved = await fcmTokens.findOneBy({ token: 'new-device-token' });
      expect(saved?.userId).toBe(uid);
      expect(saved?.platform).toBe('android');
    });

    it('re-registering the same token upserts instead of duplicating', async () => {
      const uid = await newUser();
      for (let i = 0; i < 2; i++) {
        await http
          .patch('/users/me/fcm-token')
          .set('x-test-user-id', uid)
          .send({ fcmToken: 'dupe-token' })
          .expect(200);
      }
      const rows = await fcmTokens.findBy({ token: 'dupe-token' });
      expect(rows).toHaveLength(1);
    });

    it('removes the caller’s fcm token on logout', async () => {
      const uid = await newUser();
      await fcmTokens.save(fcmTokens.create({ userId: uid, token: 'logout-token' }));

      const res = await http
        .delete('/users/me/fcm-token')
        .query({ fcmToken: 'logout-token' })
        .set('x-test-user-id', uid)
        .expect(200);
      expect(res.body).toEqual({ success: true });

      expect(await fcmTokens.findOneBy({ token: 'logout-token' })).toBeNull();
    });

    it('does not remove a token owned by another user', async () => {
      const owner = await newUser();
      const attacker = await newUser();
      await fcmTokens.save(fcmTokens.create({ userId: owner, token: 'owned-token' }));

      await http
        .delete('/users/me/fcm-token')
        .query({ fcmToken: 'owned-token' })
        .set('x-test-user-id', attacker)
        .expect(200);

      // 스코프가 userId 라 남의 토큰은 그대로 남아있어야 한다.
      expect(await fcmTokens.findOneBy({ token: 'owned-token' })).not.toBeNull();
    });
  });

  describe('profile image', () => {
    it('rejects an upload with no file (400)', async () => {
      const uid = await newUser();
      await http.post('/users/me/profile-image').set('x-test-user-id', uid).expect(400);
    });

    it('returns 503 when storage is not configured', async () => {
      const uid = await newUser();
      await http
        .post('/users/me/profile-image')
        .set('x-test-user-id', uid)
        .attach('file', Buffer.from('fakeimage'), { filename: 'a.png', contentType: 'image/png' })
        .expect(503);
    });
  });

  describe('DELETE /users/me', () => {
    it('removes the account', async () => {
      const uid = await newUser();
      await http.delete('/users/me').set('x-test-user-id', uid).expect(204);
      expect(await users.findOneBy({ id: uid })).toBeNull();
    });

    it('also clears the user’s fcm tokens', async () => {
      const uid = await newUser();
      await fcmTokens.save(fcmTokens.create({ userId: uid, token: 'dev-a' }));
      await fcmTokens.save(fcmTokens.create({ userId: uid, token: 'dev-b' }));

      await http.delete('/users/me').set('x-test-user-id', uid).expect(204);

      expect(await fcmTokens.findBy({ userId: uid })).toHaveLength(0);
    });
  });
});
