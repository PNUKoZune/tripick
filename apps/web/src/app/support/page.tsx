import type { Metadata } from 'next';

import { SupportView } from '@/views/support/ui/support-view';

export const metadata: Metadata = {
  title: '고객센터 · TriPick',
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  return <SupportView from={from} />;
}
