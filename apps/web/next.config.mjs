/** @type {import('next').NextConfig} */
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

export default nextConfig;
