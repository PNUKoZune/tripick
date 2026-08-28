import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
    await raiseDevMaxListeners();
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}

/**
 * dev 전용 MaxListenersExceededWarning 억제.
 *
 * next.config 의 rewrites(/api/v1/*, /storage/*)를 타는 요청은 next dev 의 router-server 가
 * 직접 프록시하는데, 이때 한 ServerResponse 에 close 리스너가 11개 붙어 Node 기본 상한 10 을
 * 넘긴다 — Next 기본 8개(Sentry http 계측 2 + 압축 스트림 해제 + AbortController + httpxy 2 …)
 * 에 프록시 정리(proxyReq/proxyRes destroy)와 업스트림 pipe 가 얹힌 결과다. 전부 프레임워크가
 * 요청마다 붙였다 응답과 함께 떼는 리스너라 누수가 아니고, 앱 코드는 서버측 리스너를 하나도
 * 걸지 않는다.
 *
 * 프로덕션에서 올리면 진짜 누수를 가리므로 dev 에서만 올린다. 프록시 경로 자체가 next dev
 * 전용이라 라이브(Vercel 라우팅이 rewrite 처리)에는 해당 사항도 없다.
 */
async function raiseDevMaxListeners() {
  if (process.env.NODE_ENV !== 'development') return;
  // 네임스페이스 객체는 읽기 전용이라 events.defaultMaxListeners 직접 대입은 TypeError 다.
  const { EventEmitter } = await import('node:events');
  EventEmitter.defaultMaxListeners = 20;
}

// 서버 컴포넌트·route handler·server action 에서 던져진 예외를 Sentry 로 넘긴다.
export const onRequestError = Sentry.captureRequestError;
