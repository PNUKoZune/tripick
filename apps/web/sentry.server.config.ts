import * as Sentry from '@sentry/nextjs';

// Next 서버(Node) 런타임. src/instrumentation.ts 의 register() 가 동적 import 한다.
Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || undefined,
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
});
