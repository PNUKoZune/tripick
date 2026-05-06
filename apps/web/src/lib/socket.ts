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

const WS_BASE: string = process.env.NEXT_PUBLIC_WS_URL ?? '';

let socket: Socket | null = null;

export function getSocket(): Socket | null {
  if (!WS_BASE) {
    return null;
  }
  if (!socket) {
    socket = io(`${WS_BASE}/realtime`, {
      autoConnect: false,
    });
  }
  return socket;
}

export function joinTrip(tripId: string): void {
  const s = getSocket();
  if (!s) {
    return;
  }
  if (!s.connected) s.connect();
  s.emit('join-trip', { tripId });
}

export function onReplanResult(handler: (result: ReplanResultDto) => void): () => void {
  const s = getSocket();
  if (!s) {
    return () => undefined;
  }
  s.on('replan_result', handler);
  return () => s.off('replan_result', handler);
}

export function disconnect(): void {
  socket?.disconnect();
  socket = null;
}
