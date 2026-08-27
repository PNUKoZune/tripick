/// <reference types="jest" />

import type { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import request from 'supertest';
import { createE2EApp, TestAuthGuard } from '../e2e/create-e2e-app';
import { UserEntity } from '../../src/users/user.entity';
import { WithdrawalReasonEntity } from '../../src/users/withdrawal-reason.entity';
import { UsersController } from '../../src/users/users.controller';
import { UsersService } from '../../src/users/users.service';
import { FcmTokenEntity } from '../../src/notification/fcm-token.entity';
import { RefreshTokenEntity } from '../../src/auth/entities/refresh-token.entity';
import { EmailTokenEntity } from '../../src/auth/entities/email-token.entity';
import { PreferenceEntity } from '../../src/preferences/preference.entity';
import { FcmTokenService } from '../../src/notification/fcm-token.service';
import { StorageService } from '../../src/storage/storage.service';
import { JwtAuthGuard } from '../../src/auth/guards/jwt-auth.guard';

describe('Users (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let users: Repository<UserEntity>;
  let fcmTokens: Repository<FcmTokenEntity>;
  let withdrawals: Repository<WithdrawalReasonEntity>;
  let refreshTokens: Repository<RefreshTokenEntity>;
  let emailTokens: Repository<EmailTokenEntity>;
  let preferences: Repository<PreferenceEntity>;
  let service: UsersService;
  // 스토리지 미설정 상태를 흉내내 업로드 503 경로를 검증한다.
  const storage = {
    isReady: jest.fn().mockReturnValue(false),
    putObject: jest.fn(),
    deleteObject: jest.fn(),
    keyFromPublicUrl: jest.fn().mockReturnValue(null),
  };

  beforeAll(async () => {
    app = await createE2EApp({
      entities: [
        UserEntity,
        FcmTokenEntity,
        WithdrawalReasonEntity,
        RefreshTokenEntity,
        EmailTokenEntity,
        PreferenceEntity,
      ],
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
    withdrawals = app.get(getRepositoryToken(WithdrawalReasonEntity));
    refreshTokens = app.get(getRepositoryToken(RefreshTokenEntity));
    emailTokens = app.get(getRepositoryToken(EmailTokenEntity));
    preferences = app.get(getRepositoryToken(PreferenceEntity));
    service = app.get(UsersService);
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

    /**
     * 예전엔 `@Body('fcmToken')`·`@Query('fcmToken')` 로 원시 값을 받아 전역
     * ValidationPipe 를 아예 타지 않았다 — 길이·타입 검사가 없어 아무 값이나 그대로
     * 저장됐고, 문자열이 아니면 서비스의 `token.trim()` 에서 500 이 났다.
     */
    it('rejects a non-string fcm token with 400 instead of crashing', async () => {
      const uid = await newUser();
      await http
        .patch('/users/me/fcm-token')
        .set('x-test-user-id', uid)
        .send({ fcmToken: { evil: true } })
        .expect(400);
      await http
        .patch('/users/me/fcm-token')
        .set('x-test-user-id', uid)
        .send({ fcmToken: 12345 })
        .expect(400);
    });

    it('rejects an absurdly long fcm token', async () => {
      const uid = await newUser();
      await http
        .patch('/users/me/fcm-token')
        .set('x-test-user-id', uid)
        .send({ fcmToken: 'a'.repeat(5000) })
        .expect(400);
      expect(await fcmTokens.count()).toBeGreaterThanOrEqual(0);
    });

    it('rejects an unknown platform value', async () => {
      const uid = await newUser();
      await http
        .patch('/users/me/fcm-token')
        .set('x-test-user-id', uid)
        .send({ fcmToken: 'valid-looking-token', platform: 'nintendo' })
        .expect(400);
      expect(await fcmTokens.findOneBy({ token: 'valid-looking-token' })).toBeNull();
    });

    it('rejects a delete with no token instead of silently succeeding', async () => {
      const uid = await newUser();
      await http.delete('/users/me/fcm-token').set('x-test-user-id', uid).expect(400);
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

  describe('POST /users/me/withdrawal', () => {
    it('removes the account when the confirm phrase matches', async () => {
      const uid = await newUser();
      await http
        .post('/users/me/withdrawal')
        .set('x-test-user-id', uid)
        .send({ confirmation: '탈퇴', reason: 'no_plan' })
        .expect(204);
      expect(await users.findOneBy({ id: uid })).toBeNull();
    });

    it('rejects a wrong or missing confirm phrase and keeps the account', async () => {
      const uid = await newUser();
      await http
        .post('/users/me/withdrawal')
        .set('x-test-user-id', uid)
        .send({ confirmation: '탈퇴할래요' })
        .expect(400);
      await http
        .post('/users/me/withdrawal')
        .set('x-test-user-id', uid)
        .send({})
        .expect(400);

      expect(await users.findOneBy({ id: uid })).not.toBeNull();
    });

    it('rejects an unknown reason code', async () => {
      const uid = await newUser();
      await http
        .post('/users/me/withdrawal')
        .set('x-test-user-id', uid)
        .send({ confirmation: '탈퇴', reason: 'nope' })
        .expect(400);
      expect(await users.findOneBy({ id: uid })).not.toBeNull();
    });

    it('rejects non-string fields with 400 instead of crashing', async () => {
      const uid = await newUser();
      await http
        .post('/users/me/withdrawal')
        .set('x-test-user-id', uid)
        .send({ confirmation: 5 })
        .expect(400);
      await http
        .post('/users/me/withdrawal')
        .set('x-test-user-id', uid)
        .send({ confirmation: '탈퇴', reasonDetail: 123 })
        .expect(400);
      await http
        .post('/users/me/withdrawal')
        .set('x-test-user-id', uid)
        .send({ confirmation: '탈퇴', reasonDetail: 'a'.repeat(501) })
        .expect(400);

      expect(await users.findOneBy({ id: uid })).not.toBeNull();
    });

    /**
     * 취향 사진·프로필 이미지는 익명 다운로드가 열린 `public/` 프리픽스에 있고 DB 밖이라
     * CASCADE 가 닿지 않는다. 안 지우면 탈퇴한 사용자의 개인 사진이 URL 만으로 계속 열린다.
     */
    it('deletes the uploaded images from storage', async () => {
      const uid = await newUser({ profileImageUrl: '/storage/public/profiles/u/1.jpg' });
      await preferences.save(
        preferences.create({
          userId: uid,
          photoUrls: [
            '/storage/public/preferences/u/1-0.jpg',
            '/storage/public/preferences/u/1-1.jpg',
          ],
        }),
      );
      storage.keyFromPublicUrl.mockImplementation((url: string) =>
        url.replace('/storage/', ''),
      );
      storage.deleteObject.mockResolvedValue(undefined);
      storage.deleteObject.mockClear();

      await http
        .post('/users/me/withdrawal')
        .set('x-test-user-id', uid)
        .send({ confirmation: '탈퇴' })
        .expect(204);

      const deleted = storage.deleteObject.mock.calls.map(([key]: [string]) => key).sort();
      expect(deleted).toEqual([
        'public/preferences/u/1-0.jpg',
        'public/preferences/u/1-1.jpg',
        'public/profiles/u/1.jpg',
      ]);
      storage.keyFromPublicUrl.mockReturnValue(null);
    });

    // 카카오 프로필 등 외부 URL 은 우리 버킷이 아니라 지울 대상이 아니다(키 추출이 null).
    it('leaves external profile images alone', async () => {
      const uid = await newUser({ profileImageUrl: 'https://k.kakaocdn.net/x/y.jpg' });
      storage.deleteObject.mockClear();

      await http
        .post('/users/me/withdrawal')
        .set('x-test-user-id', uid)
        .send({ confirmation: '탈퇴' })
        .expect(204);

      expect(storage.deleteObject).not.toHaveBeenCalled();
    });

    // 오브젝트 삭제가 실패해도 계정 삭제는 이미 커밋됐다 — 500 을 주면 "탈퇴가 안 됐다"로 읽힌다.
    it('still completes the withdrawal when object deletion fails', async () => {
      const uid = await newUser({ profileImageUrl: '/storage/public/profiles/u/9.jpg' });
      storage.keyFromPublicUrl.mockImplementation((url: string) =>
        url.replace('/storage/', ''),
      );
      storage.deleteObject.mockRejectedValue(new Error('storage down'));

      await http
        .post('/users/me/withdrawal')
        .set('x-test-user-id', uid)
        .send({ confirmation: '탈퇴' })
        .expect(204);

      expect(await users.findOneBy({ id: uid })).toBeNull();
      storage.keyFromPublicUrl.mockReturnValue(null);
      storage.deleteObject.mockResolvedValue(undefined);
    });

    it('stores the reason anonymously (no user reference)', async () => {
      const uid = await newUser();
      await http
        .post('/users/me/withdrawal')
        .set('x-test-user-id', uid)
        .send({ confirmation: '탈퇴', reason: 'other', reasonDetail: '  앱이 무거워요  ' })
        .expect(204);

      const rows = await withdrawals.findBy({ reason: 'other' });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.detail).toBe('앱이 무거워요');
      expect(rows[0]?.accountAgeDays).toBe(0);
      expect(JSON.stringify(rows[0])).not.toContain(uid);
    });

    it('allows skipping the reason', async () => {
      const uid = await newUser();
      await http
        .post('/users/me/withdrawal')
        .set('x-test-user-id', uid)
        .send({ confirmation: '탈퇴' })
        .expect(204);

      const rows = await withdrawals.find();
      expect(rows.some((row) => row.reason === null && row.detail === null)).toBe(true);
    });

    it('also clears the user’s fcm, refresh and email tokens', async () => {
      const uid = await newUser();
      await fcmTokens.save(fcmTokens.create({ userId: uid, token: 'dev-a' }));
      await fcmTokens.save(fcmTokens.create({ userId: uid, token: 'dev-b' }));
      // FK 가 없는 테이블들 — 탈퇴가 직접 지우지 않으면 남아서 /auth/refresh 가 계속 발급한다.
      await refreshTokens.save(
        refreshTokens.create({
          userId: uid,
          tokenHash: `hash-${uid}`,
          familyId: `fam-${uid}`,
          expiresAt: new Date(Date.now() + 86_400_000),
        }),
      );
      await emailTokens.save(
        emailTokens.create({
          userId: uid,
          purpose: 'verify_email',
          tokenHash: `mail-${uid}`,
          expiresAt: new Date(Date.now() + 86_400_000),
        }),
      );

      await http
        .post('/users/me/withdrawal')
        .set('x-test-user-id', uid)
        .send({ confirmation: '탈퇴' })
        .expect(204);

      expect(await fcmTokens.findBy({ userId: uid })).toHaveLength(0);
      expect(await refreshTokens.findBy({ userId: uid })).toHaveLength(0);
      expect(await emailTokens.findBy({ userId: uid })).toHaveLength(0);
    });
  });

  describe('카카오 재로그인 보정', () => {
    it('가입 때 못 받은 이메일을 재로그인에서 채운다', async () => {
      const created = await service.findOrCreateByKakao({ id: 'kakao-fill-1', nickname: '여행자' });
      expect(created.email).toBeFalsy();

      const relogin = await service.findOrCreateByKakao({
        id: 'kakao-fill-1',
        nickname: '여행자',
        email: 'Filled@Tripick.test',
      });

      expect(relogin.id).toBe(created.id); // 새 계정이 생기면 안 된다
      expect(relogin.email).toBe('filled@tripick.test');
      expect(relogin.emailVerifiedAt).toBeTruthy();
    });

    it('사용자가 정한 닉네임은 카카오 값으로 되돌리지 않는다', async () => {
      const created = await service.findOrCreateByKakao({ id: 'kakao-fill-2', nickname: '여행자' });
      await service.update(created.id, { nickname: '내가 정한 이름' });

      const relogin = await service.findOrCreateByKakao({
        id: 'kakao-fill-2',
        nickname: '카카오닉',
      });

      expect(relogin.nickname).toBe('내가 정한 이름');
    });
  });

  describe('핸들 자동 생성', () => {
    it('한글 닉네임 가입자끼리 핸들이 겹치지 않는다 (user, user1 … 순번 아님)', async () => {
      const a = await service.findOrCreateByKakao({ id: 'kakao-han-1', nickname: '여행자' });
      const b = await service.findOrCreateByKakao({ id: 'kakao-han-2', nickname: '여행자' });

      expect(a.handle).not.toBe(b.handle);
      // 공용 root 를 순번으로 다투던 옛 동작('user', 'user1')이 돌아오면 여기서 걸린다.
      expect(a.handle).toMatch(/^user[0-9a-f]{6}$/);
      expect(b.handle).toMatch(/^user[0-9a-f]{6}$/);
    });

    it('ASCII 가 있는 이름은 그대로 root 로 쓴다', async () => {
      const user = await service.findOrCreateByKakao({ id: 'kakao-ascii-1', nickname: 'Voyager' });
      expect(user.handle).toBe('voyager');
    });

    it('자동 생성 핸들도 사용자가 지정할 수 있는 형식(3~20자)을 지킨다', async () => {
      const created = await service.createEmailUser({
        email: 'handle-shape@tripick.test',
        nickname: '한글이름',
      });
      expect(created?.handle).toMatch(/^[a-z0-9_]{3,20}$/);
    });
  });
});
