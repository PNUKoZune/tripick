import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TriPick — 취향 기반 AI 여행 플래너',
  description: '취향 입력부터 일정 생성, 재계획까지 한 흐름으로 보여주는 TriPick web demo',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#f4f6fb',
};

const kakaoMapKey = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css"
        />
        {kakaoMapKey ? (
          <script
            type="text/javascript"
            src={`//dapi.kakao.com/v2/maps/sdk.js?appkey=${kakaoMapKey}&libraries=services`}
            async
          />
        ) : null}
      </head>
      <body>{children}</body>
    </html>
  );
}
