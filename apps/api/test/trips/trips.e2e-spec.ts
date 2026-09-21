/// <reference types="jest" />

import type { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import request from 'supertest';
import { createE2EApp, TestAuthGuard } from '../e2e/create-e2e-app';
import { TripEntity } from '../../src/trips/trip.entity';
import { TripDayEntity } from '../../src/trips/trip-day.entity';
import { TripMemberEntity } from '../../src/trip-members/trip-member.entity';
import { UserEntity } from '../../src/users/user.entity';
import { TripsController } from '../../src/trips/trips.controller';
import { TripsService } from '../../src/trips/trips.service';
import { TripGenerationService } from '../../src/trip-generation/trip-generation.service';
import { JwtAuthGuard } from '../../src/auth/guards/jwt-auth.guard';

const NON_EXISTENT_ID = '00000000-0000-4000-8000-000000000000';

const validTrip = () => ({
  title: '부산 여행',
  destination: '부산',
  startDate: '2026-07-10',
  endDate: '2026-07-11',
  wakeTime: '08:00',
  sleepTime: '22:00',
  transportMode: 'transit',
});

describe('Trips (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  // Redis/Worker는 e2e 범위 밖이라 큐 서비스를 대체하고 등록·상태 조회 연결만 관찰한다.
  const enqueue = jest.fn(async ({ tripId }: { tripId: string }) => ({
    tripId,
    status: 'queued',
    stage: 'queued',
    progress: 5,
    attempt: 1,
    maxAttempts: 3,
  }));
  const getStatus = jest.fn(async (tripId: string) => ({
    tripId,
    status: 'processing',
    stage: 'discovering_places',
    progress: 35,
    attempt: 1,
    maxAttempts: 3,
  }));
  const assertRetryable = jest.fn();
  let trips: Repository<TripEntity>;
  let userA: string;
  let userB: string;

  beforeAll(async () => {
    app = await createE2EApp({
      entities: [UserEntity, TripEntity, TripDayEntity, TripMemberEntity],
      controllers: [TripsController],
      providers: [
        TripsService,
        {
          provide: TripGenerationService,
          useValue: { enqueue, getStatus, assertRetryable },
        },
      ],
      overrideGuards: [{ guard: JwtAuthGuard, useValue: TestAuthGuard }],
    });
    http = request(app.getHttpServer());

    const users = app.get<Repository<UserEntity>>(getRepositoryToken(UserEntity));
    trips = app.get<Repository<TripEntity>>(getRepositoryToken(TripEntity));
    userA = (await users.save(users.create({ nickname: '앨리스' }))).id;
    userB = (await users.save(users.create({ nickname: '밥' }))).id;
  });

  afterAll(async () => {
    await app?.close();
  });

  async function createTrip(userId: string, body = validTrip()): Promise<string> {
    const res = await http.post('/trips').set('x-test-user-id', userId).send(body).expect(202);
    return res.body.id;
  }

  describe('POST /trips', () => {
    it('creates a generating trip and enqueues the itinerary without waiting for a worker', async () => {
      enqueue.mockClear();
      const res = await http.post('/trips').set('x-test-user-id', userA).send(validTrip()).expect(202);

      expect(res.body).toMatchObject({ userId: userA, destination: '부산', status: 'generating' });
      expect(res.body.id).toEqual(expect.any(String));
      expect(enqueue).toHaveBeenCalledWith({ tripId: res.body.id, userId: userA });
    });

    it('rejects a trip whose endDate precedes startDate (400)', async () => {
      await http
        .post('/trips')
        .set('x-test-user-id', userA)
        .send({ ...validTrip(), startDate: '2026-07-11', endDate: '2026-07-10' })
        .expect(400);
    });

    it('rejects a trip whose wakeTime equals sleepTime (400)', async () => {
      await http
        .post('/trips')
        .set('x-test-user-id', userA)
        .send({ ...validTrip(), wakeTime: '08:00', sleepTime: '08:00' })
        .expect(400);
    });

    it('rejects unknown fields and malformed values (400)', async () => {
      // DTO 를 인터페이스 타입으로 받으면 metatype 이 Object 라 ValidationPipe 가 통째로
      // 건너뛴다. 이 경로가 다시 인터페이스로 돌아가면 아래가 성공 응답으로 통과한다.
      const res = await http
        .post('/trips')
        .set('x-test-user-id', userA)
        .send({
          ...validTrip(),
          wakeTime: 'banana',
          transportMode: 'teleport',
          injectedField: 'should-be-rejected',
        })
        .expect(400);

      expect(res.body.message.join('\n')).toContain('injectedField');
    });

    it('accepts a trip whose sleepTime crosses midnight', async () => {
      // 야행성 사용자(08:00 기상 / 01:00 취침). 벽시계로 비교하면 취침이 기상보다 이르지만
      // 자정을 넘는 정상 구간이므로 거부하면 안 된다.
      await http
        .post('/trips')
        .set('x-test-user-id', userA)
        .send({ ...validTrip(), wakeTime: '08:00', sleepTime: '01:00' })
        .expect(202);
    });
  });

  describe('GET /trips', () => {
    it('lists only the caller-owned trips', async () => {
      const tripId = await createTrip(userA);

      const mine = await http.get('/trips').set('x-test-user-id', userA).expect(200);
      expect(mine.body.map((t: TripEntity) => t.id)).toContain(tripId);

      const others = await http.get('/trips').set('x-test-user-id', userB).expect(200);
      expect(others.body.map((t: TripEntity) => t.id)).not.toContain(tripId);
    });
  });

  describe('GET /trips/:id', () => {
    it('returns the trip to its owner', async () => {
      const tripId = await createTrip(userA);
      const res = await http.get(`/trips/${tripId}`).set('x-test-user-id', userA).expect(200);
      expect(res.body.id).toBe(tripId);
    });

    it('forbids access to another user’s trip (403)', async () => {
      const tripId = await createTrip(userA);
      await http.get(`/trips/${tripId}`).set('x-test-user-id', userB).expect(403);
    });

    it('returns 404 for a non-existent trip', async () => {
      await http.get(`/trips/${NON_EXISTENT_ID}`).set('x-test-user-id', userA).expect(404);
    });
  });

  describe('GET /trips/:id/generation', () => {
    it('returns the owner-scoped BullMQ progress DTO', async () => {
      const tripId = await createTrip(userA);
      const res = await http
        .get(`/trips/${tripId}/generation`)
        .set('x-test-user-id', userA)
        .expect(200);
      expect(res.body).toMatchObject({
        tripId,
        status: 'processing',
        stage: 'discovering_places',
        progress: 35,
      });
      expect(getStatus).toHaveBeenCalledWith(tripId, 'generating');
    });

    it('forbids another user from reading generation progress', async () => {
      const tripId = await createTrip(userA);
      await http
        .get(`/trips/${tripId}/generation`)
        .set('x-test-user-id', userB)
        .expect(403);
    });
  });

  describe('POST /trips/:id/generation/retry', () => {
    it('moves a failed owner trip back to generating and re-enqueues it', async () => {
      const tripId = await createTrip(userA);
      await trips.update({ id: tripId }, { status: 'generation_failed' });
      enqueue.mockClear();
      assertRetryable.mockClear();

      const res = await http
        .post(`/trips/${tripId}/generation/retry`)
        .set('x-test-user-id', userA)
        .send({})
        .expect(202);

      expect(res.body).toMatchObject({ tripId, status: 'queued' });
      expect(assertRetryable).toHaveBeenCalledWith('generation_failed');
      expect(enqueue).toHaveBeenCalledWith({ tripId, userId: userA });
      await expect(trips.findOneByOrFail({ id: tripId })).resolves.toMatchObject({
        status: 'generating',
      });
    });

    it('forbids another user from retrying the owner trip', async () => {
      const tripId = await createTrip(userA);
      await trips.update({ id: tripId }, { status: 'generation_failed' });
      await http
        .post(`/trips/${tripId}/generation/retry`)
        .set('x-test-user-id', userB)
        .send({})
        .expect(403);
    });
  });

  describe('PATCH /trips/:id', () => {
    it('updates fields for the owner', async () => {
      const tripId = await createTrip(userA);
      const res = await http
        .patch(`/trips/${tripId}`)
        .set('x-test-user-id', userA)
        .send({ title: '수정된 부산 여행' })
        .expect(200);
      expect(res.body.title).toBe('수정된 부산 여행');
    });

    it('forbids updating another user’s trip (403)', async () => {
      const tripId = await createTrip(userA);
      await http
        .patch(`/trips/${tripId}`)
        .set('x-test-user-id', userB)
        .send({ title: '탈취 시도' })
        .expect(403);
    });
  });

  describe('DELETE /trips/:id', () => {
    it('removes the trip for its owner and makes it unreachable afterwards', async () => {
      const tripId = await createTrip(userA);
      await http.delete(`/trips/${tripId}`).set('x-test-user-id', userA).expect(204);
      await http.get(`/trips/${tripId}`).set('x-test-user-id', userA).expect(404);
    });

    it('forbids deleting another user’s trip (403)', async () => {
      const tripId = await createTrip(userA);
      await http.delete(`/trips/${tripId}`).set('x-test-user-id', userB).expect(403);
    });
  });
});
