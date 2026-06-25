import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import type { JwtPayload, ReplanResultDto } from '@tripick/types';
import { TripMembersService } from '../trip-members/trip-members.service';

/** 인증을 통과한 소켓의 client.data 에 담기는 사용자 정보 */
interface AuthedSocketData {
  user: JwtPayload;
}

type AuthedSocket = Socket & { data: AuthedSocketData };

/**
 * Socket.IO WebSocket Gateway
 *
 * 채널:
 * - trip-session:{tripId}  — 여행 세션
 * - deviation:{tripId}     — 경로 이탈 이벤트
 * - replan-result:{tripId} — 재계획 결과 push
 *
 * 인증: 핸드셰이크의 `auth.token` (또는 Authorization 헤더) JWT 를 검증한다.
 * 검증 실패 시 즉시 연결을 끊는다.
 */
@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/realtime',
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly tripMembersService: TripMembersService,
  ) {}

  async handleConnection(client: Socket) {
    const token = extractToken(client);
    if (!token) {
      this.logger.warn(`WS rejected (no token): ${client.id}`);
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      (client as AuthedSocket).data.user = payload;
      this.logger.log(`WS connected: ${client.id} (user ${payload.sub})`);
    } catch {
      this.logger.warn(`WS rejected (invalid token): ${client.id}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`WS disconnected: ${client.id}`);
  }

  @SubscribeMessage('join-trip')
  async handleJoinTrip(
    @MessageBody() data: { tripId: string },
    @ConnectedSocket() client: AuthedSocket,
  ) {
    const userId = client.data.user.sub;
    const allowed = await this.tripMembersService.canAccessTrip(data.tripId, userId);
    if (!allowed) {
      this.logger.warn(`WS join denied: user ${userId} → trip ${data.tripId}`);
      return { event: 'join-denied', tripId: data.tripId };
    }

    void client.join(`trip-session:${data.tripId}`);
    return { event: 'joined', tripId: data.tripId };
  }

  @SubscribeMessage('report-deviation')
  handleDeviation(
    @MessageBody() data: { tripId: string; lat: number; lng: number },
  ) {
    this.server
      .to(`trip-session:${data.tripId}`)
      .emit('deviation', { tripId: data.tripId, location: { lat: data.lat, lng: data.lng } });
  }

  /** Planner / Alternative 모듈에서 재계획 완료 시 호출 */
  pushReplanResult(result: ReplanResultDto) {
    this.server
      .to(`trip-session:${result.tripId}`)
      .emit('replan_result', result);
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
