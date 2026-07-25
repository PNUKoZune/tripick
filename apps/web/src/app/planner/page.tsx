import type { ReplanTrigger } from '@tripick/types';

import { PlannerView } from '@/views/planner/ui/planner-view';

const REPLAN_TRIGGERS: readonly ReplanTrigger[] = ['deviation', 'weather', 'crowd', 'manual'];

function parseReplanTrigger(value: string | undefined): ReplanTrigger | undefined {
  return value && (REPLAN_TRIGGERS as readonly string[]).includes(value)
    ? (value as ReplanTrigger)
    : undefined;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tripId?: string; day?: string; proposalId?: string; replan?: string }>;
}) {
  const { tripId, day, proposalId, replan } = await searchParams;
  const initialDay = Number(day);
  const initialReplanTrigger = parseReplanTrigger(replan);
  return (
    <PlannerView
      {...(tripId ? { tripId } : {})}
      {...(Number.isInteger(initialDay) && initialDay > 0 ? { initialDay } : {})}
      {...(proposalId ? { initialProposalId: proposalId } : {})}
      {...(initialReplanTrigger ? { initialReplanTrigger } : {})}
    />
  );
}
