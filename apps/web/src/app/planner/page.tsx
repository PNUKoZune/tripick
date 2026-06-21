import { PlannerView } from '@/views/planner/ui/planner-view';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tripId?: string }>;
}) {
  const { tripId } = await searchParams;
  return <PlannerView {...(tripId ? { tripId } : {})} />;
}
