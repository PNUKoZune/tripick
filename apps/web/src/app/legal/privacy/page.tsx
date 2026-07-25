import type { Metadata } from 'next';

import { LegalPrivacyView } from '@/views/legal-privacy/ui/legal-privacy-view';

export const metadata: Metadata = {
  title: '개인정보처리방침 · Tripick',
};

export default function Page() {
  return <LegalPrivacyView />;
}
