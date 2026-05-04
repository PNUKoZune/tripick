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
import type { ReplanResultDto } from '@tripick/types';

/**
 * Socket.IO WebSocket Gateway
 *
 * 채널:
 * - trip-session:{tripId}  — 여행 세션
 * - deviation:{tripId}     — 경로 이탈 이벤트
 * - replan-result:{tripId} — 재계획 결과 push
 */
@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/realtime',
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    console.log(`WS connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`WS disconnected: ${client.id}`);
  }

  @SubscribeMessage('join-trip')
  handleJoinTrip(
    @MessageBody() data: { tripId: string },
    @ConnectedSocket() client: Socket,
  ) {
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
