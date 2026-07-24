import { TripCreateView } from '@/views/trip-create/ui/trip-create-view';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ destination?: string; friendId?: string }>;
}) {
  const { destination, friendId } = await searchParams;
  return (
    <TripCreateView
      {...(destination ? { initialDestination: destination } : {})}
      {...(friendId ? { initialFriendId: friendId } : {})}
    />
  );
}
