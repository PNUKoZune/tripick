import { withSentryConfig } from '@sentry/nextjs';
import { createRequire } from 'node:module';

/** @type {import('next').NextConfig} */
const require = createRequire(import.meta.url);
// 화면에 노출하는 앱 버전의 단일 출처. 하드코딩하면 package.json 이 올라도 따로 논다.
const { version: appVersion } = require('./package.json');
const backendOrigin = process.env.TRIPICK_API_ORIGIN ?? 'http://127.0.0.1:4000';
// 객체 스토리지(로컬 MinIO)도 API 와 같은 상대경로 프록시를 태운다. 절대 URL(localhost:9000)은
// 웹뷰에서 기기 자신을 가리켜 이미지가 안 떴다. 라이브(R2)는 STORAGE_PUBLIC_URL 을 절대 URL 로
// 두면 이 프록시가 안 쓰인다.
const storageOrigin = process.env.TRIPICK_STORAGE_ORIGIN ?? 'http://127.0.0.1:9000/tripick';

const nextConfig = {
  transpilePackages: ['@tripick/types'],
  // RN WebView 셸이 로드하는 dev 호스트. Next 15 는 cross-origin /_next/* 요청을
  // 기본 차단하므로, 안 넣으면 청크·HMR 이 막혀 WebView 가 하이드레이션되지 않는다.
  // 10.0.2.2=Android 에뮬레이터, localhost=iOS 시뮬레이터. 물리 기기는 PC LAN IP 추가.
  allowedDevOrigins: ['127.0.0.1', 'localhost', '10.0.2.2'],
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? '/api/v1',
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL ?? '',
    NEXT_PUBLIC_KAKAO_MAP_KEY: process.env.NEXT_PUBLIC_KAKAO_MAP_KEY ?? '',
    NEXT_PUBLIC_APP_VERSION: appVersion,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN ?? '',
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? '',
  },
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${backendOrigin}/api/v1/:path*`,
      },
      {
        source: '/storage/:path*',
        destination: `${storageOrigin}/:path*`,
      },
    ];
  },
};

// org·project 슬러그와 authToken 은 소스맵 업로드(빌드 시점)에만 쓰인다. 레포에 박지 않고
// env 로 주입하며, 셋 중 하나라도 없으면 업로드를 끈다 — 로컬 빌드가 인증 실패로 죽지 않게.
const sentryAuth = {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
};
const canUploadSourcemaps = Boolean(sentryAuth.org && sentryAuth.project && sentryAuth.authToken);

export default withSentryConfig(nextConfig, {
  ...sentryAuth,
  sourcemaps: { disable: !canUploadSourcemaps },
  // 클라이언트 번들 소스맵 범위를 넓혀 서버 컴포넌트 청크의 스택도 원본 파일로 풀린다.
  widenClientFileUpload: true,
  // 광고 차단기·WebView 네트워크 정책에 이벤트가 막히지 않도록 자기 도메인으로 우회 전송.
  tunnelRoute: '/monitoring',
  silent: !process.env.CI,
});
