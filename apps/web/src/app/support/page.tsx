import type { Metadata } from 'next';

import { SupportView } from '@/views/support/ui/support-view';

export const metadata: Metadata = {
  title: '고객센터 · TriPick',
};

export default function Page() {
  return <SupportView />;
}
