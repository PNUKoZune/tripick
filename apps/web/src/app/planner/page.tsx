import { PlannerView } from '@/views/planner/ui/planner-view';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tripId?: string; day?: string; proposalId?: string }>;
}) {
  const { tripId, day, proposalId } = await searchParams;
  const initialDay = Number(day);
  return (
    <PlannerView
      {...(tripId ? { tripId } : {})}
      {...(Number.isInteger(initialDay) && initialDay > 0 ? { initialDay } : {})}
      {...(proposalId ? { initialProposalId: proposalId } : {})}
    />
  );
}
