/// <reference types="jest" />

import type { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import request from 'supertest';
import type { TripMemberDto } from '@tripick/types';
import { createE2EApp, TestAuthGuard } from '../e2e/create-e2e-app';
import { UserEntity } from '../../src/users/user.entity';
import { TripEntity } from '../../src/trips/trip.entity';
import { TripMemberEntity } from '../../src/trip-members/trip-member.entity';
import { TripMembersController } from '../../src/trip-members/trip-members.controller';
import { TripMembersService } from '../../src/trip-members/trip-members.service';
import { PreferencesService } from '../../src/preferences/preferences.service';
import { RealtimeGateway } from '../../src/realtime/realtime.gateway';
import { InboxService } from '../../src/inbox/inbox.service';
import { JwtAuthGuard } from '../../src/auth/guards/jwt-auth.guard';

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

describe('Trip members (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let users: Repository<UserEntity>;
  let trips: Repository<TripEntity>;
  let owner: string;
  let outsider: string;
  let members: Repository<TripMemberEntity>;
  const realtime = { evictFromTrip: jest.fn().mockResolvedValue(undefined) };
  const inbox = {
    create: jest.fn().mockResolvedValue(null),
    clearTripInvite: jest.fn().mockResolvedValue(undefined),
    cancelTripInvite: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    app = await createE2EApp({
      entities: [UserEntity, TripEntity, TripMemberEntity],
      controllers: [TripMembersController],
      providers: [
        TripMembersService,
        { provide: PreferencesService, useValue: { findByUser: jest.fn().mockResolvedValue(null) } },
        // 멤버 제거는 소켓 축출(RealtimeGateway)과 알림(InboxService)을 부른다. 스텁이 없어
        // 이 스위트가 DI 실패로 통째로 죽어 있었다 — CI 가 test:e2e 를 안 돌려 아무도 몰랐다.
        { provide: RealtimeGateway, useValue: realtime },
        { provide: InboxService, useValue: inbox },
      ],
      overrideGuards: [{ guard: JwtAuthGuard, useValue: TestAuthGuard }],
    });
    http = request(app.getHttpServer());
    users = app.get(getRepositoryToken(UserEntity));
    trips = app.get(getRepositoryToken(TripEntity));
    members = app.get(getRepositoryToken(TripMemberEntity));
    owner = (await users.save(users.create({ nickname: '오너' }))).id;
    outsider = (await users.save(users.create({ nickname: '외부인' }))).id;
  });

  afterAll(async () => {
    await app?.close();
  });

  const newTrip = async (ownerId: string) =>
    (
      await trips.save(
        trips.create({
          userId: ownerId,
          title: '부산 여행',
          destination: '부산',
          startDate: '2026-07-10',
          endDate: '2026-07-11',
          status: 'confirmed',
          transportMode: 'transit',
        }),
      )
    ).id;

  const membersOf = async (tripId: string, userId: string): Promise<TripMemberDto[]> =>
    (await http.get(`/trips/${tripId}/members`).set('x-test-user-id', userId).expect(200)).body;

  describe('GET members', () => {
    it('auto-creates the owner member on the owner’s first read', async () => {
      const tripId = await newTrip(owner);
      const members = await membersOf(tripId, owner);
      expect(members).toHaveLength(1);
      expect(members[0]).toMatchObject({ role: 'owner', status: 'accepted', nickname: '오너' });
    });

    it('forbids a non-member (403)', async () => {
      const tripId = await newTrip(owner);
      await http.get(`/trips/${tripId}/members`).set('x-test-user-id', outsider).expect(403);
    });

    it('returns 404 for a missing trip', async () => {
      await http.get(`/trips/${MISSING_ID}/members`).set('x-test-user-id', owner).expect(404);
    });
  });

  describe('POST members', () => {
    it('lets the owner add a companion', async () => {
      const tripId = await newTrip(owner);
      const res = await http
        .post(`/trips/${tripId}/members`)
        .set('x-test-user-id', owner)
        .send({ nickname: '동행자' })
        .expect(201);
      expect(res.body).toMatchObject({ role: 'companion', nickname: '동행자' });
    });

    it('rejects an empty nickname (400)', async () => {
      const tripId = await newTrip(owner);
      await http
        .post(`/trips/${tripId}/members`)
        .set('x-test-user-id', owner)
        .send({ nickname: '   ' })
        .expect(400);
    });

    it('forbids a non-owner from adding members (403)', async () => {
      const tripId = await newTrip(owner);
      await http
        .post(`/trips/${tripId}/members`)
        .set('x-test-user-id', outsider)
        .send({ nickname: '침입자' })
        .expect(403);
    });
  });

  describe('PATCH members/:memberId', () => {
    it('updates a member for the owner', async () => {
      const tripId = await newTrip(owner);
      const created = await http
        .post(`/trips/${tripId}/members`)
        .set('x-test-user-id', owner)
        .send({ nickname: '동행자' })
        .expect(201);

      const res = await http
        .patch(`/trips/${tripId}/members/${created.body.id}`)
        .set('x-test-user-id', owner)
        .send({ nickname: '수정된동행자', relation: '친구' })
        .expect(200);
      expect(res.body).toMatchObject({ nickname: '수정된동행자', relation: '친구' });
    });

    it('returns 404 for a missing member', async () => {
      const tripId = await newTrip(owner);
      await http
        .patch(`/trips/${tripId}/members/${MISSING_ID}`)
        .set('x-test-user-id', owner)
        .send({ nickname: 'x' })
        .expect(404);
    });
  });

  describe('DELETE members/:memberId', () => {
    it('removes a companion but refuses to remove the owner member', async () => {
      const tripId = await newTrip(owner);
      const companion = await http
        .post(`/trips/${tripId}/members`)
        .set('x-test-user-id', owner)
        .send({ nickname: '동행자' })
        .expect(201);
      // owner 멤버를 만들기 위해 한 번 조회
      const members = await membersOf(tripId, owner);
      const ownerMember = members.find((m) => m.role === 'owner')!;

      await http
        .delete(`/trips/${tripId}/members/${companion.body.id}`)
        .set('x-test-user-id', owner)
        .expect(204);
      await http
        .delete(`/trips/${tripId}/members/${ownerMember.id}`)
        .set('x-test-user-id', owner)
        .expect(400);
    });

    /**
     * 회수된 멤버가 열려 있는 소켓으로 재계획 결과를 계속 받으면 인가가 무의미해진다.
     * `join-trip` 은 재입장마다 재검증하지만 **이미 room 에 있는 소켓**은 능동 축출이 필요하다.
     * 이 스위트가 DI 실패로 죽어 있던 동안 이 동작은 한 번도 검증되지 않았다.
     */
    it('evicts the removed member from the live trip room', async () => {
      const tripId = await newTrip(owner);
      const joiner = (await users.save(users.create({ nickname: '합류자' }))).id;
      const member = await members.save(
        members.create({ tripId, userId: joiner, nickname: '합류자', status: 'accepted' }),
      );
      realtime.evictFromTrip.mockClear();
      inbox.create.mockClear();

      await http
        .delete(`/trips/${tripId}/members/${member.id}`)
        .set('x-test-user-id', owner)
        .expect(204);

      expect(realtime.evictFromTrip).toHaveBeenCalledWith(tripId, joiner);
      // 소켓만 끊으면 여행이 조용히 사라져 이유를 알 수 없다 — 통지도 함께 나가야 한다.
      expect(inbox.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: joiner, category: 'general' }),
      );
    });

    // 실계정이 아닌 초안 멤버(userId 없음)는 축출할 소켓이 없다.
    it('does not try to evict a draft member with no account', async () => {
      const tripId = await newTrip(owner);
      const companion = await http
        .post(`/trips/${tripId}/members`)
        .set('x-test-user-id', owner)
        .send({ nickname: '초안동행자' })
        .expect(201);
      realtime.evictFromTrip.mockClear();

      await http
        .delete(`/trips/${tripId}/members/${companion.body.id}`)
        .set('x-test-user-id', owner)
        .expect(204);

      expect(realtime.evictFromTrip).not.toHaveBeenCalled();
    });

    it('forbids a non-owner from removing members (403)', async () => {
      const tripId = await newTrip(owner);
      const companion = await http
        .post(`/trips/${tripId}/members`)
        .set('x-test-user-id', owner)
        .send({ nickname: '동행자' })
        .expect(201);
      await http
        .delete(`/trips/${tripId}/members/${companion.body.id}`)
        .set('x-test-user-id', outsider)
        .expect(403);
    });
  });

  describe('GET preference-coordination', () => {
    it('returns consensus and a recommendation for accepted members', async () => {
      const tripId = await newTrip(owner);
      await http
        .post(`/trips/${tripId}/members`)
        .set('x-test-user-id', owner)
        .send({ nickname: '동행자', preferenceTags: { food: ['cafe'], mood: ['romantic'] } })
        .expect(201);

      const res = await http
        .get(`/trips/${tripId}/preference-coordination`)
        .set('x-test-user-id', owner)
        .expect(200);

      expect(res.body.tripId).toBe(tripId);
      expect(Array.isArray(res.body.members)).toBe(true);
      expect(res.body.consensus.food.length).toBeGreaterThan(0);
      expect(res.body.recommendation.title).toEqual(expect.any(String));
    });
  });
});
