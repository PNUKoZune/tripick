import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const backendOrigin = process.env.TRIPICK_API_ORIGIN ?? 'http://127.0.0.1:4000';
// 객체 스토리지(로컬 MinIO)도 API 와 같은 상대경로 프록시를 태운다. 절대 URL(localhost:9000)은
// 웹뷰에서 기기 자신을 가리켜 이미지가 안 떴다. 라이브(R2)는 STORAGE_PUBLIC_URL 을 절대 URL 로
// 두면 이 프록시가 안 쓰인다.
const storageOrigin = process.env.TRIPICK_STORAGE_ORIGIN ?? 'http://127.0.0.1:9000/tripick';
// 취향 사진은 **비공개 버킷**에 있어 서명 URL 로만 읽힌다. 공개 프록시와 목적지 버킷이 달라
// 경로를 따로 둔다. API 의 `PRIVATE_PROXY_PATH` 와 짝이므로 한쪽만 바꾸면 이미지가 404 난다.
// ⚠️ host 가 API 의 STORAGE_ENDPOINT 와 정확히 같아야 한다 — SigV4 가 host 를 서명에 포함해서
// (`X-Amz-SignedHeaders=host`) 다르면 403 SignatureDoesNotMatch 가 난다.
const privateStorageOrigin =
  process.env.TRIPICK_PRIVATE_STORAGE_ORIGIN ?? 'http://127.0.0.1:9000/tripick-private';

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
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN ?? '',
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? '',
  },
  async headers() {
    return [
      {
        // 전 경로 공통 보안 헤더.
        //
        // frame-ancestors/X-Frame-Options 는 브리지 origin 검사(bridge-origin.ts)와 한 쌍이다 —
        // 프레이밍을 막으면 공격자 페이지가 우리 문서를 띄워 postMessage 를 던지는 통로 자체가
        // 사라진다. 둘 중 하나만으로도 막히지만, 새 message 리스너가 추가될 때를 대비해
        // 플랫폼 레벨에서도 닫아 둔다. (RN WebView 는 프레임이 아니라 최상위 문서라 무영향)
        //
        // nosniff 는 특히 /storage 프록시 때문에 필요하다 — 사용자가 올린 바이트를 같은
        // 오리진에서 되돌려주므로, 브라우저가 Content-Type 을 무시하고 스니핑하면 안 된다.
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      {
        // self-host 폰트. 경로에 버전이 박혀 있어(`pretendard-1.3.9`) 내용이 바뀔 일이
        // 없으므로 1년 immutable 로 못 박는다 — Next 는 public/ 기본이 max-age=0 이라
        // 방문할 때마다 92개 서브셋에 재검증 요청이 붙는다.
        source: '/fonts/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
  async redirects() {
    return [
      {
        // `/start` 는 예전 소개 화면 주소다. 지금은 루트가 세션을 보고 소개·홈을 스스로
        // 가르므로 같은 내용이 두 주소에 있을 이유가 없다. 밖에 나간 링크만 살려 둔다.
        source: '/start',
        destination: '/',
        permanent: true,
      },
    ];
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
      {
        source: '/storage-private/:path*',
        destination: `${privateStorageOrigin}/:path*`,
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
