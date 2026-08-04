import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}

// 서버 컴포넌트·route handler·server action 에서 던져진 예외를 Sentry 로 넘긴다.
export const onRequestError = Sentry.captureRequestError;
