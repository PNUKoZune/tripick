/// <reference types="jest" />

import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { io, type Socket } from 'socket.io-client';
import type { ReplanResultDto } from '@tripick/types';
import { RealtimeGateway } from '../../src/realtime/realtime.gateway';
import { TripMembersService } from '../../src/trip-members/trip-members.service';

/**
 * RealtimeGateway 인증/인가 e2e
 *
 * 실제 socket.io 서버를 임의 포트로 띄우고 진짜 클라이언트로 붙어, 게이트웨이의
 * handleConnection(토큰 검증)·handleJoinTrip(멤버십 인가)·evictFromTrip(회수)
 * 경로를 WS 왕복으로 검증한다. JWT 는 실제 JwtModule 로 서명/검증하고,
 * 멤버십 판정(canAccessTrip)만 목킹해 DB 없이 인가 분기를 제어한다.
 */
describe('RealtimeGateway 인증/인가 e2e', () => {
  const JWT_SECRET = 'gateway-e2e-secret';
  const MEMBER_TRIP = 'trip-member';
  const OUTSIDER_TRIP = 'trip-outsider';

  let app: INestApplication;
  let realtimeUrl: string;
  let jwt: JwtService;

  // canAccessTrip: 사용자가 접근 가능한 (tripId) 화이트리스트로 판정을 제어한다.
  const canAccessTrip = jest.fn(async (tripId: string) => tripId === MEMBER_TRIP);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: JWT_SECRET, signOptions: { expiresIn: '1h' } })],
      providers: [
        RealtimeGateway,
        { provide: TripMembersService, useValue: { canAccessTrip } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0);
    jwt = app.get(JwtService);

    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    realtimeUrl = `http://127.0.0.1:${port}/realtime`;
  });

  afterAll(async () => {
    await app?.close();
  });

  function tokenFor(userId: string): string {
    return jwt.sign({ sub: userId });
  }

  it('토큰이 없으면 연결을 즉시 끊는다', async () => {
    const outcome = await probeConnection(realtimeUrl, undefined);
    expect(outcome).toBe('rejected');
  });

  it('토큰이 유효하지 않으면 연결을 끊는다', async () => {
    const outcome = await probeConnection(realtimeUrl, 'not-a-real-token');
    expect(outcome).toBe('rejected');
  });

  it('유효 토큰이면 연결을 유지하고 본인 인박스 room 에 자동 합류한다', async () => {
    const userId = 'user-inbox';
    const socket = await connect(realtimeUrl, tokenFor(userId));
    try {
      const invalidated = waitForEvent(socket, 'inbox_invalidate', 3000);
      // room 합류가 됐다면 이 사용자 인박스 room 방송을 받는다(payload 없는 신호 이벤트).
      app.get(RealtimeGateway).pushInboxInvalidate(userId);
      await invalidated; // 타임아웃 없이 도달하면 room 합류가 검증된다
      expect(socket.connected).toBe(true);
    } finally {
      socket.close();
    }
  });

  it('join-trip: 멤버면 joined 를 응답한다', async () => {
    const socket = await connect(realtimeUrl, tokenFor('member-user'));
    try {
      const ack = await emitWithAck(socket, 'join-trip', { tripId: MEMBER_TRIP });
      expect(ack).toEqual({ event: 'joined', tripId: MEMBER_TRIP });
    } finally {
      socket.close();
    }
  });

  it('join-trip: 비멤버면 join-denied 를 응답하고 room 방송을 받지 못한다', async () => {
    const socket = await connect(realtimeUrl, tokenFor('outsider-user'));
    try {
      const ack = await emitWithAck(socket, 'join-trip', { tripId: OUTSIDER_TRIP });
      expect(ack).toEqual({ event: 'join-denied', tripId: OUTSIDER_TRIP });

      // 거부됐으므로 해당 trip room 방송이 이 소켓에 도달하면 안 된다.
      const leaked = waitForEvent(socket, 'replan_result', 500);
      app.get(RealtimeGateway).pushReplanResult(replanResult(OUTSIDER_TRIP));
      await expect(leaked).rejects.toThrow(/timed out/);
    } finally {
      socket.close();
    }
  });

  it('evictFromTrip: 회수된 사용자를 room 에서 내보내고 알린 뒤 방송을 끊는다', async () => {
    const userId = 'evicted-user';
    const socket = await connect(realtimeUrl, tokenFor(userId));
    try {
      const joinAck = await emitWithAck(socket, 'join-trip', { tripId: MEMBER_TRIP });
      expect(joinAck).toEqual({ event: 'joined', tripId: MEMBER_TRIP });

      // 회수: 소켓은 trip-access-revoked 를 받고 room 을 떠나야 한다.
      const revoked = waitForEvent<{ tripId: string }>(socket, 'trip-access-revoked', 3000);
      await app.get(RealtimeGateway).evictFromTrip(MEMBER_TRIP, userId);
      await expect(revoked).resolves.toEqual({ tripId: MEMBER_TRIP });

      // 퇴장 후에는 trip room 방송이 더 이상 도달하지 않는다.
      const afterEvict = waitForEvent(socket, 'replan_result', 500);
      app.get(RealtimeGateway).pushReplanResult(replanResult(MEMBER_TRIP));
      await expect(afterEvict).rejects.toThrow(/timed out/);
    } finally {
      socket.close();
    }
  });
});

function replanResult(tripId: string): ReplanResultDto {
  return { jobId: `job-${tripId}`, tripId, status: 'completed' };
}

/** 붙어서 유지되면 'accepted', 서버가 끊거나 handshake 실패면 'rejected'. */
function probeConnection(url: string, token: string | undefined): Promise<'accepted' | 'rejected'> {
  return new Promise((resolve) => {
    const socket = io(url, {
      auth: token ? { token } : {},
      reconnection: false,
      timeout: 5000,
      forceNew: true,
    });

    const settle = (outcome: 'accepted' | 'rejected') => {
      clearTimeout(timer);
      socket.close();
      resolve(outcome);
    };

    // 붙은 채로 잠시 유지되면 accept 로 본다(서버가 즉시 끊지 않았다는 뜻).
    const timer = setTimeout(() => settle('accepted'), 1000);

    socket.on('connect_error', () => settle('rejected'));
    socket.on('disconnect', () => settle('rejected'));
  });
}

/** 붙을 때까지 기다렸다가 연결된 소켓을 돌려준다. */
function connect(url: string, token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(url, { auth: { token }, reconnection: false, timeout: 5000, forceNew: true });
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('connect timed out'));
    }, 6000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function emitWithAck<T = { event: string; tripId: string }>(
  socket: Socket,
  event: string,
  payload: unknown,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} ack timed out`)), 5000);
    socket.emit(event, payload, (ack: T) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

function waitForEvent<T = unknown>(socket: Socket, event: string, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timed out`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}
