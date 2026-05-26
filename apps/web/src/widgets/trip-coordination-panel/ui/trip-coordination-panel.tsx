'use client';

import { useQuery } from '@tanstack/react-query';
import type {
  PlannerCoordinationDto,
  PlannerCoordinationVoteRowDto,
} from '@tripick/types';

import { fetchPlannerCoordination } from '@/entities/trip-plan';
import { queryKeys } from '@/shared/api/query-keys';

type Props = {
  tripId: string;
};

export function TripCoordinationPanel({ tripId }: Props) {
  const { data, isPending, error } = useQuery<PlannerCoordinationDto>({
    queryKey: queryKeys.planner.coordination(tripId),
    queryFn: () => fetchPlannerCoordination(tripId),
    staleTime: 60 * 1000,
  });

  if (error) {
    return (
      <div className="rounded-[16px] border border-[#FECDD3] bg-[#FFECEE] p-4 text-[14px] text-[#F04452]">
        {error instanceof Error ? error.message : '조율 결과를 불러오지 못했어요.'}
      </div>
    );
  }

  if (isPending || !data) {
    return (
      <div className="space-y-3">
        <div className="h-16 animate-pulse rounded-[16px] bg-[#F2F4F6]" />
        <div className="h-40 animate-pulse rounded-[16px] bg-[#F2F4F6]" />
        <div className="h-32 animate-pulse rounded-[16px] bg-[#F2F4F6]" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-[20px] border border-[#E5E8EB] bg-white p-4">
        <h2 className="text-[15px] font-bold text-[#191F28]">멤버별 취향</h2>
        <p className="mt-0.5 text-[12px] text-[#8B95A1]">
          {data.members.length}명의 취향이 어떻게 모였는지 확인하고 조율 결과를 살펴봐요.
        </p>
        <div className="mt-3 space-y-2">
          {data.members.map((member) => (
            <div key={member.id} className="flex items-center gap-3">
              <span
                aria-hidden
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white"
                style={{ background: member.color }}
              >
                {member.initial}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-bold text-[#191F28]">
                  {member.initial}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {member.tasteLabels.map((label) => (
                    <span
                      key={label}
                      className="rounded-full bg-[#F2F4F6] px-2 py-0.5 text-[11px] font-semibold text-[#6B7684]"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[20px] border border-[#E5E8EB] bg-white p-4">
        <h2 className="text-[15px] font-bold text-[#191F28]">취향 비교</h2>
        <div className="mt-3 divide-y divide-[#F2F4F6]">
          <VoteGroup title="식사" votes={data.consensus.food} />
          <VoteGroup title="관광" votes={data.consensus.mood} />
          <VoteGroup title="선호 환경" votes={data.consensus.environment} />
        </div>
      </section>

      <section className="rounded-[20px] border border-[#BFD7FF] bg-[#EAF2FF] p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-bold text-[#1B64DA]">AI 절충 추천</h2>
          <span className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-semibold text-[#1B64DA]">
            자동 생성
          </span>
        </div>
        <div className="mt-3 text-[17px] font-bold leading-[24px] text-[#191F28]">
          {data.recommendation.title}
        </div>
        <p className="mt-2 text-[13px] leading-[20px] text-[#4E5968]">
          {data.recommendation.summary}
        </p>
        <ul className="mt-3 space-y-1">
          {data.recommendation.reasons.map((reason) => (
            <li key={reason} className="text-[13px] leading-[20px] text-[#1B64DA]">
              {reason}
            </li>
          ))}
        </ul>
        <div className="mt-4 border-t border-[#BFD7FF] pt-3 text-[12px] font-semibold text-[#4E5968]">
          {data.recommendation.scheduleHint}
        </div>
      </section>
    </div>
  );
}

function VoteGroup({
  title,
  votes,
}: {
  title: string;
  votes: PlannerCoordinationVoteRowDto[];
}) {
  const total = votes.reduce((sum, row) => sum + row.count, 0) || 1;
  const top = votes[0];
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between text-[13px]">
        <span className="font-bold text-[#191F28]">{title}</span>
        <span className="font-semibold text-[#6B7684]">{top?.label ?? '대기'}</span>
      </div>
      <div className="mt-2 space-y-2">
        {votes.slice(0, 3).map((vote) => (
          <div key={vote.key}>
            <div className="flex items-center justify-between text-[11px] font-semibold text-[#8B95A1]">
              <span>{vote.label}</span>
              <span>{vote.voters.length > 0 ? vote.voters.join(' · ') : '—'}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#F2F4F6]">
              <div
                className="h-full rounded-full bg-[#3182F6]"
                style={{ width: `${Math.max(8, (vote.count / total) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
