'use client';

import { LuCheck, LuClock, LuUserCheck } from 'react-icons/lu';

import { useScheduleChanges } from '@/entities/schedule-change';
import { useScheduleChangeActions } from '../model/use-schedule-change-actions';

type Props = {
  tripId: string;
  isOwner: boolean;
  /** owner: 제안 클릭 시 diff 미리보기 모달 열기 */
  onOpenProposal?: (proposalId: string) => void;
};

/**
 * 대기중 일정 변경 제안 패널.
 * - owner: 참여자들이 낸 모든 대기 제안 + "변경 내용 보기"(diff→승인/거절)
 * - 참여자: 본인이 낸 대기 제안 + 취소
 * 대기 제안이 없으면 아무것도 렌더하지 않는다.
 */
export function PendingProposalsPanel({ tripId, isOwner, onOpenProposal }: Props) {
  const { data } = useScheduleChanges(tripId);
  const { cancel } = useScheduleChangeActions(tripId);
  const proposals = data?.proposals ?? [];
  if (proposals.length === 0) return null;

  return (
    <section className="mb-3 rounded-[16px] border border-[#FFE0BD] bg-[#FFFBF3] p-4">
      <div className="flex items-center gap-1.5 text-[13px] font-bold text-[#B45309]">
        <LuClock className="size-4" aria-hidden />
        {isOwner ? '승인 대기 중인 변경 요청' : '승인 대기 중인 내 요청'}
        <span className="ml-0.5 rounded-full bg-[#FDE68A] px-1.5 text-[11px] text-[#92400E]">
          {proposals.length}
        </span>
      </div>
      <ul className="mt-2.5 space-y-2">
        {proposals.map((proposal) => (
          <li
            key={proposal.id}
            className="flex items-center gap-3 rounded-[12px] border border-[#F1E4C9] bg-white px-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-[#191F28]">
                {proposal.summary}
              </p>
              {isOwner ? (
                <p className="mt-0.5 flex items-center gap-1 text-[12px] text-[#8B95A1]">
                  <LuUserCheck className="size-3.5" aria-hidden />
                  {proposal.requester.nickname}
                </p>
              ) : null}
            </div>
            {isOwner ? (
              <button
                type="button"
                onClick={() => onOpenProposal?.(proposal.id)}
                className="flex h-8 shrink-0 items-center gap-1 rounded-[10px] bg-[#3182F6] px-3 text-[12px] font-bold text-white hover:bg-[#1B64DA]"
              >
                <LuCheck className="size-3.5" aria-hidden />
                검토
              </button>
            ) : (
              <button
                type="button"
                onClick={() => cancel.mutate(proposal.id)}
                // 여러 제안이 있을 때 눌린 행만 비활성화한다(공유 mutation 오작동 방지)
                disabled={cancel.isPending && cancel.variables === proposal.id}
                className="h-8 shrink-0 rounded-[10px] border border-[#E5E8EB] bg-white px-3 text-[12px] font-semibold text-[#6B7684] hover:bg-[#FAFBFC] disabled:opacity-50"
              >
                {cancel.isPending && cancel.variables === proposal.id ? '취소 중…' : '요청 취소'}
              </button>
            )}
          </li>
        ))}
      </ul>
      {!isOwner && cancel.isError ? (
        <p className="mt-2 text-[12px] font-medium text-[#F04452]">
          요청을 취소하지 못했어요. 이미 처리됐을 수 있어요.
        </p>
      ) : null}
    </section>
  );
}
