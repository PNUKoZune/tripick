import type { Metadata } from 'next';

import { DemoConsoleView } from '@/views/demo-console/ui/demo-console-view';

/** 발표자만 주소로 들어오는 보조 도구 — 색인은 막는다. */
export const metadata: Metadata = {
  title: '시연 콘솔',
  robots: { index: false, follow: false },
};

export default function Page() {
  return <DemoConsoleView />;
}
