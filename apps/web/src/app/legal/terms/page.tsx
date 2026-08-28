import type { Metadata } from 'next';

import { LegalTermsView } from '@/views/legal-terms/ui/legal-terms-view';

export const metadata: Metadata = {
  title: '이용약관 · TriPick',
};

export default function Page() {
  return <LegalTermsView />;
}
