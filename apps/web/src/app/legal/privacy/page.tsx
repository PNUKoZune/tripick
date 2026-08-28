import type { Metadata } from 'next';

import { LegalPrivacyView } from '@/views/legal-privacy/ui/legal-privacy-view';

export const metadata: Metadata = {
  title: '개인정보처리방침 · TriPick',
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  return <LegalPrivacyView from={from} />;
}
