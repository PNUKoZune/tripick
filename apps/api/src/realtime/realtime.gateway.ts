import { Inject, Logger, forwardRef, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  Ack,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import type { InboxToastDto, JwtPayload, ReplanResultDto } from '@tripick/types';
import { TripMembersService } from '../trip-members/trip-members.service';
import { corsOrigins } from '../common/cors';
import { JWT_ALGORITHM } from '../common/jwt-secrets';
import { AccessSessionsService } from '../auth/access-sessions.service';

/** 인증을 통과한 소켓의 client.data 에 담기는 사용자 정보 */
interface AuthedSocketData {
  user: JwtPayload;
  expiryTimer?: ReturnType<typeof setTimeout>;
}

type AuthedSocket = Socket & { data: AuthedSocketData };
type JoinTripAck = (response: { event: 'joined' | 'join-denied'; tripId: string }) => void;

/**
 * Socket.IO WebSocket Gateway
 *
 * 채널:
 * - trip-session:{tripId}  — 여행 세션 (재계획 결과 push 포함)
 *
 * 경로 이탈은 더 이상 클라이언트가 WS 로 신고하지 않는다. `ArrivalAlertModule`
 * (서버 5분 주기 스캔)이 판정해 inbox + FCM 으로 알린다(CLAUDE.md §7).
 *
 * 인증: 핸드셰이크의 `auth.token` (또는 Authorization 헤더) JWT 를 검증한다.
 * 검증 실패 시 즉시 연결을 끊는다.
 * 인가: `join-trip` 시 여행 접근 권한을 검증한다. 멤버십이 회수되면
 * `evictFromTrip` 으로 해당 사용자의 소켓을 room 에서 즉시 내보낸다.
 */
@WebSocketGateway({
  cors: { origin: corsOrigins() },
  namespace: '/realtime',
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeGateway.name);
  private unsubscribe?: () => void;

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwtService: JwtService,
    @Inject(forwardRef(() => TripMembersService))
    private readonly tripMembersService: TripMembersService,
    private readonly sessions: AccessSessionsService,
  ) {}

  onModuleInit() {
    this.unsubscribe = this.sessions.onRevoked(({ userId, sid }) => {
      if (!this.server) return;
      const room = sid ? `session:${sid}` : `inbox:${userId}`;
      this.server.in(room).disconnectSockets(true);
    });
  }

  onModuleDestroy() { this.unsubscribe?.(); }

  afterInit(server: Server) {
    // Finish authentication before Socket.IO acknowledges the handshake. Otherwise an
    // immediate join-trip can race the asynchronous session lookup in handleConnection.
    server.use(async (client, next) => {
      try {
        const token = extractToken(client);
        if (!token) throw new Error('Missing token');
        const payload = await this.jwtService.verifyAsync<JwtPayload>(token, { algorithms: [JWT_ALGORITHM] });
        await this.sessions.validate(payload);
        (client as AuthedSocket).data.user = payload;
        next();
      } catch { next(new Error('Unauthorized')); }
    });
  }

  async handleConnection(client: Socket) {
    const token = extractToken(client);
    if (!token) {
      this.logger.warn(`WS rejected (no token): ${client.id}`);
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        algorithms: [JWT_ALGORITHM],
      });
      await this.sessions.validate(payload);
      (client as AuthedSocket).data.user = payload;
      await client.join(`session:${payload.sid}`);
      await client.join(`inbox:${payload.sub}`);
      // Join both revocation rooms before rechecking to close handshake/logout/reset races.
      await this.sessions.validate(payload);
      if (!client.connected) return;
      (client as AuthedSocket).data.expiryTimer = setTimeout(
        () => client.disconnect(true), Math.min(payload.exp! * 1000 - Date.now(), 2_147_483_647),
      );
      this.logger.log(`WS connected: ${client.id} (user ${payload.sub})`);
    } catch {
      this.logger.warn(`WS rejected (invalid token): ${client.id}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    clearTimeout((client as AuthedSocket).data.expiryTimer);
    this.logger.log(`WS disconnected: ${client.id}`);
  }

  @SubscribeMessage('join-trip')
  async handleJoinTrip(
    @MessageBody() data: { tripId: string },
    @ConnectedSocket() client: AuthedSocket,
    @Ack() ack?: JoinTripAck,
  ) {
    try {
      await this.sessions.validate(client.data.user ?? { sub: '' });
    } catch {
      client.disconnect(true);
      return;
    }
    if (typeof data?.tripId !== 'string') return;
    const userId = client.data.user.sub;
    const allowed = await this.tripMembersService.canAccessTrip(data.tripId, userId);
    if (!allowed) {
      this.logger.warn(`WS join denied: user ${userId} → trip ${data.tripId}`);
      const response = { event: 'join-denied' as const, tripId: data.tripId };
      ack?.(response);
      return response;
    }

    await client.join(`trip-session:${data.tripId}`);
    const response = { event: 'joined' as const, tripId: data.tripId };
    ack?.(response);
    return response;
  }

  /** Planner / Alternative 모듈에서 재계획 완료 시 호출 */
  pushReplanResult(result: ReplanResultDto) {
    this.server
      .to(`trip-session:${result.tripId}`)
      .emit('replan_result', result);
  }

  /**
   * 인박스에 새 알림이 생겼을 때 사용자의 모든 소켓에 신호를 보낸다.
   * 브라우저 단독(RN 밖) 사용자는 FCM 브릿지를 못 받으므로, 이 신호로 클라이언트가
   * 인박스 목록을 다시 불러오게 한다(payload 없이 invalidate 트리거만).
   */
  pushInboxInvalidate(userId: string) {
    this.server.to(`inbox:${userId}`).emit('inbox_invalidate');
  }

  /**
   * 앱이 열려 있는(소켓 연결) 클라이언트에 즉시 토스트를 띄운다.
   * 목록 갱신(pushInboxInvalidate)과 독립적인 능동 알림 — 친구 요청처럼 heads-up 이
   * 필요한 흐름에서만 호출한다. FCM 이 닫힌 앱을 담당한다면 이건 열린 앱을 담당한다.
   */
  pushInboxToast(userId: string, toast: InboxToastDto) {
    this.server.to(`inbox:${userId}`).emit('inbox_toast', toast);
  }

  /**
   * 여행 멤버십이 회수된 사용자의 소켓을 해당 여행 room 에서 내보낸다.
   * `join-trip` 은 재입장마다 접근 권한을 재검증하므로, 이미 접속해 room 에 남아
   * 있는 소켓만 여기서 능동적으로 정리하면 인가가 유지된다.
   * (멤버 제거 시 `TripMembersService.remove` 가 호출)
   */
  async evictFromTrip(tripId: string, userId: string): Promise<void> {
    const room = `trip-session:${tripId}`;
    const sockets = await this.server.in(room).fetchSockets();
    for (const socket of sockets) {
      if ((socket.data as AuthedSocketData).user?.sub === userId) {
        socket.emit('trip-access-revoked', { tripId });
        await socket.leave(room);
      }
    }
  }
}

/** 핸드셰이크 auth.token → Authorization 헤더 순으로 Bearer 토큰을 추출한다. */
function extractToken(client: Socket): string | null {
  const authToken = client.handshake.auth?.token;
  if (typeof authToken === 'string' && authToken.length > 0) {
    return authToken.replace(/^Bearer\s+/i, '');
  }

  const header = client.handshake.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice(7);
  }

  return null;
}
