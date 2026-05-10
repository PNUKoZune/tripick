/** @type {import('next').NextConfig} */
const backendOrigin = process.env.TRIPICK_API_ORIGIN ?? 'http://127.0.0.1:4000';

const nextConfig = {
  transpilePackages: ['@tripick/types'],
  allowedDevOrigins: ['127.0.0.1'],
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
