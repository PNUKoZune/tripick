/** @type {import('next').NextConfig} */
const backendOrigin = process.env.TRIPICK_API_ORIGIN ?? 'http://127.0.0.1:4000';

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
  },
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${backendOrigin}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
