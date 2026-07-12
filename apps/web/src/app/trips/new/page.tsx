import { TripCreateView } from '@/views/trip-create/ui/trip-create-view';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ destination?: string }>;
}) {
  const { destination } = await searchParams;
  return <TripCreateView {...(destination ? { initialDestination: destination } : {})} />;
}
