import { io, type Socket } from 'socket.io-client';

import { getAccessToken } from '@/shared/lib/session-token';

/** NestJS RealtimeGateway 의 namespace (`@WebSocketGateway({ namespace: '/realtime' })`) */
const REALTIME_NAMESPACE = '/realtime';

let socket: Socket | null = null;

function resolveWsBase(): string {
  const fromEnv = process.env.NEXT_PUBLIC_WS_URL;
  if (fromEnv) return fromEnv;
  if (typeof window === 'undefined') return ''; // SSR 단계에서는 호출되지 않음
  // dev: 백엔드는 웹을 서빙한 것과 같은 호스트의 4000 포트에 있다(브라우저=localhost, 에뮬=10.0.2.2).
  // origin 을 그대로 쓰면 Next(:3000)로 가버리므로 호스트만 취해 포트를 백엔드로 바꾼다 —
  // 이렇게 하면 절대 URL env 를 타깃마다 갈아끼우지 않아도 브라우저·에뮬레이터가 자동으로 맞는다.
  if (process.env.NODE_ENV === 'development') {
    const { protocol, hostname } = window.location;
    return `${protocol}//${hostname}:4000`;
  }
  // prod 는 NEXT_PUBLIC_WS_URL 이 설정돼 위에서 반환됨. 미설정이면 same-origin(nginx WS 업그레이드) 폴백.
  return window.location.origin;
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
