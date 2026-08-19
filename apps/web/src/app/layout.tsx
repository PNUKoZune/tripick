import type { Metadata, Viewport } from 'next';
import { Providers } from './providers';
import './globals.css';

// og:image·twitter:image 는 같은 폴더의 opengraph-image.png 파일 컨벤션이 자동 주입한다.
// 절대 URL 의 기준(metadataBase)은 Vercel 이 배포 URL 에서 자동 유도한다.
export const metadata: Metadata = {
  title: 'Tripick — 취향 조율 여행 플래너',
  description: '동행 멤버의 취향을 맞추고 국내 여행 일정을 준비하는 Tripick',
  openGraph: {
    title: 'Tripick — 취향 조율 여행 플래너',
    description: '동행 멤버의 취향을 맞추고 국내 여행 일정을 준비하는 Tripick',
    siteName: 'Tripick',
    type: 'website',
    locale: 'ko_KR',
  },
  twitter: {
    card: 'summary_large_image',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // 브라우저·웹뷰 크롬 색. 단일 값으로 두면 화면이 다크로 넘어가도 상단 바만 흰색으로 남는다.
  // 값은 "광안리의 하루" 팔레트의 --bg (라이트 #F5F7FB / 다크 #0B111E) 와 맞춘다.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F5F7FB' },
    { media: '(prefers-color-scheme: dark)', color: '#0B111E' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://dapi.kakao.com" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css"
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
