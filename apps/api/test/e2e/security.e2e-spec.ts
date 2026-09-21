import request from 'supertest';
import { DataSource, type Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { io, type Socket } from 'socket.io-client';
import { createServer } from 'node:http';
import { createIntegrationApp } from './integration-app';
import { PreferenceEntity } from '../../src/preferences/preference.entity';
import { TripEntity } from '../../src/trips/trip.entity';
import { TripMemberEntity } from '../../src/trip-members/trip-member.entity';
import { ItineraryItemEntity } from '../../src/itinerary/itinerary-item.entity';
import { ItineraryService } from '../../src/itinerary/itinerary.service';
import { MainPlannerService } from '../../src/main-planner/main-planner.service';
import { UsersService } from '../../src/users/users.service';
import type { LoginResponseDto } from '@tripick/types';

describe('Security regression E2E with real JWT and persistence', () => {
  let fixture: Awaited<ReturnType<typeof createIntegrationApp>>;
  let http: ReturnType<typeof request>;
  let alice: LoginResponseDto;
  let bob: LoginResponseDto;
  let trip: TripEntity;
  let items: ItineraryItemEntity[];
  let member: TripMemberEntity;
  let prefs: Repository<PreferenceEntity>;
  let trips: Repository<TripEntity>;
  let itinerary: Repository<ItineraryItemEntity>;
  let realtimeUrl: string;
  const password = 'Security-test123';
  const sockets: Socket[] = [];

  beforeAll(async () => {
    fixture = await createIntegrationApp();
    await fixture.app.listen(0, '127.0.0.1');
    http = request(fixture.app.getHttpServer());
    realtimeUrl = `${await fixture.app.getUrl()}/realtime`;
    prefs = fixture.app.get(getRepositoryToken(PreferenceEntity));
    trips = fixture.app.get(getRepositoryToken(TripEntity));
    itinerary = fixture.app.get(getRepositoryToken(ItineraryItemEntity));
    alice = await signup('alice');
    bob = await signup('bob');
    trip = await trips.save(
      trips.create({
        userId: alice.user.id,
        title: '권한 테스트',
        destination: '부산',
        startDate: '2030-09-10',
        endDate: '2030-09-10',
      }),
    );
    items = await itinerary.save(
      [1, 2].map((order) =>
        itinerary.create({
          tripId: trip.id,
          day: 1,
          order,
          type: 'cafe',
          name: `카페 ${order}`,
          address: '부산',
          scheduledAt: new Date(`2030-09-10T${order + 9}:00:00+09:00`),
          durationMin: 60,
          coordinates: { lat: 35.15, lng: 129.11 },
        }),
      ),
    );
    const members = fixture.app.get<Repository<TripMemberEntity>>(
      getRepositoryToken(TripMemberEntity),
    );
    member = await members.save(
      members.create({ tripId: trip.id, userId: bob.user.id, nickname: 'Bob', status: 'accepted' }),
    );
  });

  afterAll(async () => {
    sockets.forEach((socket) => socket.close());
    await fixture?.close();
  });

  async function signup(name: string): Promise<LoginResponseDto> {
    const email = `${name}-${Date.now()}@tripick.test`;
    await http.post('/api/v1/auth/signup').send({ email, password, nickname: name }).expect(200);
    const token = new URL(fixture.mail.get(email)!).searchParams.get('token');
    await http.post('/api/v1/auth/verify-email').send({ token }).expect(200);
    return (await http.post('/api/v1/auth/login').send({ email, password }).expect(200))
      .body as LoginResponseDto;
  }
  const bearer = (session: LoginResponseDto) => `Bearer ${session.tokens.accessToken}`;
  function connected(token: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = io(realtimeUrl, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
      });
      sockets.push(socket);
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });
  }

  it('rejects private photo assignment and ignores poisoned legacy references on read/delete', async () => {
    const victimKey = `preferences/${bob.user.id}/victim.png`;
    await http
      .put('/api/v1/preferences')
      .set('Authorization', bearer(alice))
      .send({ tasteTags: {}, photoKeys: [victimKey] })
      .expect(400);
    const ownKey = `preferences/${alice.user.id}/own.png`;
    await prefs.save(prefs.create({ userId: alice.user.id, photoKeys: [victimKey, ownKey] }));
    const result = await http
      .get('/api/v1/preferences')
      .set('Authorization', bearer(alice))
      .expect(200);
    expect(result.body.photoKeys).toEqual([ownKey]);
    expect(result.body.photos.map((photo: { key: string }) => photo.key)).toEqual([ownKey]);
    await http
      .delete('/api/v1/preference-analyzer/photos')
      .query({ key: victimKey })
      .set('Authorization', bearer(alice))
      .expect(200);
    expect(fixture.deleted).not.toContain(victimKey);
  });

  it('rejects oversized multipart images before storage or analysis', async () => {
    const image = Buffer.alloc(11 * 1024 * 1024);
    Buffer.from('89504e470d0a1a0a', 'hex').copy(image);
    await http
      .post('/api/v1/preference-analyzer/upload')
      .set('Authorization', bearer(alice))
      .attach('images', image, { filename: 'large.png', contentType: 'image/png' })
      .expect(413);
    expect(fixture.objects.size).toBe(0);
  });

  it.each(['/replanning', '/alternative/request', '/alternative/deviation'])(
    'requires owner approval at %s',
    async (path) => {
      await http
        .post(`/api/v1${path}`)
        .set('Authorization', bearer(bob))
        .send({ tripId: trip.id, trigger: 'manual' })
        .expect(403);
    },
  );

  it('does not fetch arbitrary URLs while resolving a place', async () => {
    let requests = 0;
    const trap = createServer((_req, res) => {
      requests++;
      res.end('internal');
    });
    await new Promise<void>((resolve) => trap.listen(0, '127.0.0.1', resolve));
    const address = trap.address() as { port: number };
    try {
      await http
        .post(`/api/v1/main-planner/trips/${trip.id}/items/${items[0]!.id}/resolve-place`)
        .set('Authorization', bearer(alice))
        .send({ query: `http://127.0.0.1:${address.port}/?q=secret` })
        .expect(400);
      expect(requests).toBe(0);
    } finally {
      await new Promise<void>((resolve) => trap.close(() => resolve()));
    }
  });

  it('rejects invalid times, days and duplicate reorder IDs without changing stored items', async () => {
    const endpoint = `/api/v1/main-planner/trips/${trip.id}`;
    await http
      .post(`${endpoint}/items`)
      .set('Authorization', bearer(alice))
      .send({ day: 1, name: 'bad time', scheduledAt: '99:99' })
      .expect(400);
    await http
      .post(`${endpoint}/items`)
      .set('Authorization', bearer(alice))
      .send({ day: 2, name: 'hidden day', scheduledAt: '12:00' })
      .expect(400);
    await http
      .patch(`${endpoint}/items/reorder`)
      .set('Authorization', bearer(alice))
      .send({ day: 1, orderedItemIds: [items[0]!.id, items[0]!.id] })
      .expect(400);
    expect(
      (await itinerary.find({ where: { tripId: trip.id }, order: { order: 'ASC' } })).map(
        (item) => item.id,
      ),
    ).toEqual(items.map((item) => item.id));
  });

  it('rolls back a full itinerary replacement when an insert fails', async () => {
    const service = fixture.app.get(ItineraryService);
    await expect(
      service.replaceTripItems(trip.id, [
        {
          tripId: trip.id,
          day: 1,
          order: 1,
          type: 'cafe',
          name: null as unknown as string,
          address: '부산',
          coordinates: { lat: 35, lng: 129 },
          scheduledAt: new Date().toISOString(),
          durationMin: 60,
        },
      ]),
    ).rejects.toThrow();
    expect(await itinerary.countBy({ tripId: trip.id })).toBe(2);
  });

  it('keeps trip listing queries bounded as the number of trips grows', async () => {
    await trips.save(
      Array.from({ length: 10 }, (_, i) =>
        trips.create({
          userId: alice.user.id,
          title: `목록 ${i}`,
          destination: '부산',
          startDate: '2030-09-10',
          endDate: '2030-09-10',
        }),
      ),
    );
    const source = fixture.app.get(DataSource);
    const queries = jest.spyOn(source.logger, 'logQuery');
    const user = await fixture.app.get(UsersService).findById(alice.user.id);
    queries.mockClear();
    try {
      const list = await fixture.app.get(MainPlannerService).listTrips(user!);
      expect(list).toHaveLength(11);
      expect(list.find((entry) => entry.id === trip.id)?.itemCount).toBe(2);
      expect(list.every((entry) => entry.members.some((member) => member.role === 'owner'))).toBe(
        true,
      );
      expect(
        queries.mock.calls.filter(([sql]) => sql.startsWith('SELECT')).length,
      ).toBeLessThanOrEqual(5);
      expect(queries.mock.calls.some(([sql]) => /^(INSERT|UPDATE|DELETE)/.test(sql))).toBe(false);
    } finally {
      queries.mockRestore();
    }
  });

  it('prevents owner edits to an account invitation and evicts a companion who leaves', async () => {
    await http
      .patch(`/api/v1/trips/${trip.id}/members/${member.id}`)
      .set('Authorization', bearer(alice))
      .send({ status: 'pending' })
      .expect(400);
    const socket = await connected(bob.tokens.accessToken);
    await expect(
      socket.timeout(3000).emitWithAck('join-trip', { tripId: trip.id }),
    ).resolves.toMatchObject({ event: 'joined' });
    const revoked = new Promise((resolve) => socket.once('trip-access-revoked', resolve));
    await http
      .delete(`/api/v1/main-planner/trips/${trip.id}/members/${member.id}/invite`)
      .set('Authorization', bearer(bob))
      .expect(204);
    await revoked;
    await expect(
      socket.timeout(3000).emitWithAck('join-trip', { tripId: trip.id }),
    ).resolves.toMatchObject({ event: 'join-denied' });
    socket.close();
  });

  it('revokes HTTP access and disconnects the session socket on logout after refresh rotation', async () => {
    const socket = await connected(bob.tokens.accessToken);
    const rotated = await http
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: bob.tokens.refreshToken })
      .expect(200);
    const disconnected = new Promise((resolve) => socket.once('disconnect', resolve));
    await http
      .post('/api/v1/auth/logout')
      .send({ refreshToken: rotated.body.refreshToken })
      .expect(204);
    await disconnected;
    await http.get('/api/v1/users/me').set('Authorization', bearer(bob)).expect(401);
    await http
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${rotated.body.accessToken}`)
      .expect(401);
    await http
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: rotated.body.refreshToken })
      .expect(401);
    await expect(connected(rotated.body.accessToken)).rejects.toThrow('Unauthorized');
  });

  it('revokes all existing HTTP and WebSocket sessions when the password is reset', async () => {
    const socket = await connected(alice.tokens.accessToken);
    const user = await fixture.app.get(UsersService).findById(alice.user.id);
    await http.post('/api/v1/auth/forgot-password').send({ email: user!.email }).expect(200);
    const token = new URL(fixture.mail.get(user!.email!)!).searchParams.get('token');
    const disconnected = new Promise((resolve) => socket.once('disconnect', resolve));
    await http
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'New-security123' })
      .expect(200);
    await disconnected;
    await http.get('/api/v1/users/me').set('Authorization', bearer(alice)).expect(401);
    await http
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: alice.tokens.refreshToken })
      .expect(401);
    const login = await http
      .post('/api/v1/auth/login')
      .send({ email: user!.email, password: 'New-security123' })
      .expect(200);
    await http
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
      .expect(200);
  });

  it('disconnects an existing socket and rejects tokens after account withdrawal', async () => {
    const user = await signup('withdrawal');
    const socket = await connected(user.tokens.accessToken);
    // Ensure the authenticated inbox subscription is ready before deleting the account.
    await socket.timeout(3000).emitWithAck('join-trip', { tripId: trip.id });
    const disconnected = new Promise((resolve) => socket.once('disconnect', resolve));
    await http.post('/api/v1/users/me/withdrawal')
      .set('Authorization', bearer(user))
      .send({ confirmation: '탈퇴' })
      .expect(204);
    await disconnected;
    await http.get('/api/v1/users/me').set('Authorization', bearer(user)).expect(401);
    await http.post('/api/v1/auth/refresh')
      .send({ refreshToken: user.tokens.refreshToken }).expect(401);
    await expect(connected(user.tokens.accessToken)).rejects.toThrow('Unauthorized');
  });
});
