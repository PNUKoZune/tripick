import * as Sentry from '@sentry/nextjs';

// 브라우저(및 RN WebView) 런타임. DSN 이 비어 있으면 SDK 가 no-op 이라 로컬은 그냥 꺼진 채 돈다.
Sentry.init({
  // next.config 의 env 블록이 미설정 값을 빈 문자열로 인라인하므로 ?? 가 아니라 || 로 걸러야 한다.
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || undefined,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV,
  // release 는 지정하지 않는다 — withSentryConfig 가 빌드마다 만든 릴리스 ID 를 번들에 주입하고
  // 같은 ID 로 소스맵을 올리므로, 여기서 덮으면 스택 트레이스가 원본 파일로 안 풀린다.
  // dev 는 전량, 운영은 10%. WebView 셸이 화면 전환마다 트랜잭션을 만들어 표본이 금방 쌓인다.
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
});

// App Router 클라이언트 네비게이션을 트랜잭션으로 잇는다. 없으면 라우팅 스팬이 끊긴다.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
