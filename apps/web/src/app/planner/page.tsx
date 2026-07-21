import { PlannerView } from '@/views/planner/ui/planner-view';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tripId?: string; day?: string }>;
}) {
  const { tripId, day } = await searchParams;
  const initialDay = Number(day);
  return (
    <PlannerView
      {...(tripId ? { tripId } : {})}
      {...(Number.isInteger(initialDay) && initialDay > 0 ? { initialDay } : {})}
    />
  );
}
