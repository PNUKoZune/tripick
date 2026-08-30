import type { Metadata, Viewport } from 'next';
import { Providers } from './providers';
import './globals.css';

// og:image·twitter:image 는 같은 폴더의 opengraph-image.png 파일 컨벤션이 자동 주입한다.
// 절대 URL 의 기준(metadataBase)은 Vercel 이 배포 URL 에서 자동 유도한다.
export const metadata: Metadata = {
  title: 'TriPick — 취향 조율 여행 플래너',
  description: '동행 멤버의 취향을 맞추고 국내 여행 일정을 준비하는 TriPick',
  openGraph: {
    title: 'TriPick — 취향 조율 여행 플래너',
    description: '동행 멤버의 취향을 맞추고 국내 여행 일정을 준비하는 TriPick',
    siteName: 'TriPick',
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
  // 노치·홈 인디케이터 영역까지 화면을 쓰고, 잘리면 안 되는 여백은 CSS 가
  // `env(safe-area-inset-*)`(globals.css 의 --safe-top/--safe-bottom)로 직접 잡는다.
  // 이게 없으면 env() 가 항상 0 이라 안전 영역 보정이 통째로 죽는다.
  viewportFit: 'cover',
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
        {/* 지도 SDK 는 화면에 들어와야 로드되므로 연결만 미리 열어 둔다.
            Pretendard 는 self-host(`app/pretendard.css` + `public/fonts/pretendard`)라
            서드파티 preconnect 가 더는 필요 없다. */}
        <link rel="preconnect" href="https://dapi.kakao.com" />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
