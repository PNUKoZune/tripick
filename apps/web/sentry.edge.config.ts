import * as Sentry from '@sentry/nextjs';

// Edge 런타임(미들웨어·edge route). 현재 edge 라우트는 없지만 나중에 생겨도 계측이 비지 않게 둔다.
Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || undefined,
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
});
