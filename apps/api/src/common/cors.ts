/**
 * 허용 오리진 목록을 한 곳에서 만든다. HTTP(main.ts)·WebSocket(RealtimeGateway)이
 * 같은 값을 쓰도록 공유한다.
 *
 * CORS_ORIGIN 환경변수(쉼표 구분)가 있으면 그것을, 없으면 로컬 개발 기본값을 쓴다.
 * 프로덕션(Railway 등)에서는 배포 도메인을 CORS_ORIGIN 으로 반드시 지정한다.
 *
 * 게이트웨이의 `@WebSocketGateway` 데코레이터는 모듈 import 시점에 평가되는데,
 * 프로덕션에서는 실제 프로세스 환경변수가 node 시작 전에 주입되므로 이 함수가
 * 데코레이터 안에서 호출돼도 CORS_ORIGIN 을 정상적으로 읽는다.
 */
const DEFAULT_CORS_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
];

export function corsOrigins(): string[] {
  const configured = process.env['CORS_ORIGIN'];
  if (configured) {
    return configured.split(',').map((origin) => origin.trim());
  }
  return DEFAULT_CORS_ORIGINS;
}
