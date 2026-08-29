import type { Metadata, Viewport } from 'next';
import { THEME_COLOR, THEME_INIT_SCRIPT } from '@/shared/theme';
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
  // 노치·홈 인디케이터 영역까지 화면을 쓰고, 잘리면 안 되는 여백은 CSS 가
  // `env(safe-area-inset-*)`(globals.css 의 --safe-top/--safe-bottom)로 직접 잡는다.
  // 이게 없으면 env() 가 항상 0 이라 안전 영역 보정이 통째로 죽는다.
  viewportFit: 'cover',
  // 브라우저·웹뷰 크롬 색. 사용자가 OS 와 다른 테마를 고를 수 있게 된 뒤로는 media 쌍으로
  // 둘 수 없다 — 그러면 OS 판정이 이겨 상단 바만 반대 색으로 남는다. 라이트를 정적 기본값으로
  // 심고, 실제 값은 부팅 스크립트와 ThemeProvider(applyTheme)가 이 태그를 갱신해 맞춘다.
  themeColor: THEME_COLOR.light,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: 아래 부팅 스크립트가 첫 페인트 전에 이 태그에 data-theme 를
    // 심는데, 서버 HTML 에는 없어 React 가 속성 불일치를 경고한다. 억제 범위는 이 엘리먼트의
    // 속성 한 단계뿐이라 자식 트리의 진짜 불일치는 그대로 잡힌다.
    <html lang="ko" suppressHydrationWarning>
      <head>
        {/* 지도 SDK 는 화면에 들어와야 로드되므로 연결만 미리 열어 둔다.
            Pretendard 는 self-host(`app/pretendard.css` + `public/fonts/pretendard`)라
            서드파티 preconnect 가 더는 필요 없다. */}
        <link rel="preconnect" href="https://dapi.kakao.com" />
        {/* 첫 페인트 전에 테마를 확정한다 — React 가 붙기를 기다리면 다크 사용자에게
            흰 화면이 한 번 번쩍인다. 그래서 defer 없이 head 에서 동기 실행한다. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
