import { io, type Socket } from 'socket.io-client';

import { getAccessToken } from '@/shared/lib/session-token';

/** NestJS RealtimeGateway 의 namespace (`@WebSocketGateway({ namespace: '/realtime' })`) */
const REALTIME_NAMESPACE = '/realtime';

let socket: Socket | null = null;

function resolveWsBase(): string {
  const fromEnv = process.env.NEXT_PUBLIC_WS_URL;
  if (fromEnv) return fromEnv;
  // env 미설정 시 현재 origin 으로 폴백 (SSR 단계에서는 호출되지 않음)
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

/**
 * `/realtime` 네임스페이스에 연결된 socket.io 클라이언트를 반환한다.
 * 앱 전체에서 커넥션 1개를 공유한다 (lazy singleton).
 */
export function getRealtimeSocket(): Socket {
  if (socket) return socket;

  socket = io(`${resolveWsBase()}${REALTIME_NAMESPACE}`, {
    transports: ['websocket'],
    autoConnect: true,
    // 핸드셰이크마다 최신 토큰을 실어 보낸다 (재연결 시에도 갱신된 토큰 사용)
    auth: (cb) => cb({ token: getAccessToken() ?? '' }),
  });

  return socket;
}

/** 로그아웃 등으로 커넥션을 끊어야 할 때 호출 */
export function disconnectRealtimeSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
