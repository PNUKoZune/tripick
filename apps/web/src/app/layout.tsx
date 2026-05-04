import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TriPick — AI 여행 플래너',
  description: '취향으로 골라주는 AI 여행 플래너',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <script
          type="text/javascript"
          src={`//dapi.kakao.com/v2/maps/sdk.js?appkey=${process.env.NEXT_PUBLIC_KAKAO_MAP_KEY}&libraries=services`}
          async
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
