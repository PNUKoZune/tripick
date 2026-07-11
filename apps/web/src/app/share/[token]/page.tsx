import { SharedTripView } from '@/views/shared-trip';

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SharedTripView token={token} />;
}
