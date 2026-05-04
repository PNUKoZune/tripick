/**
 * Socket.IO 클라이언트 — 재계획 결과 실시간 수신
 *
 * 채널:
 * - join-trip: 여행 세션 참가
 * - replan_result: 재계획 완료 이벤트
 * - deviation: 경로 이탈 이벤트
 */
import { io, Socket } from 'socket.io-client';
import type { ReplanResultDto } from '@tripick/types';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(`${process.env.NEXT_PUBLIC_WS_URL}/realtime`, {
      autoConnect: false,
    });
  }
  return socket;
}

export function joinTrip(tripId: string) {
  const s = getSocket();
  if (!s.connected) s.connect();
  s.emit('join-trip', { tripId });
}

export function onReplanResult(handler: (result: ReplanResultDto) => void) {
  getSocket().on('replan_result', handler);
  return () => getSocket().off('replan_result', handler);
}

export function disconnect() {
  socket?.disconnect();
  socket = null;
}
