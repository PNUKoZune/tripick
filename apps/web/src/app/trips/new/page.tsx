import { TripCreateView } from '@/views/trip-create/ui/trip-create-view';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    destination?: string;
    friendId?: string;
    generationTripId?: string;
  }>;
}) {
  const { destination, friendId, generationTripId } = await searchParams;
  return (
    <TripCreateView
      {...(destination ? { initialDestination: destination } : {})}
      {...(friendId ? { initialFriendId: friendId } : {})}
      {...(generationTripId ? { initialGenerationTripId: generationTripId } : {})}
    />
  );
}
