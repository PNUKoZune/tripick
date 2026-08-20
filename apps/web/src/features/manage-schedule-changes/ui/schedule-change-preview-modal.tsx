'use client';

import { useMemo } from 'react';
import { LuArrowRight } from 'react-icons/lu';
import type { PlannerItineraryItemDto, ScheduleChangePayload } from '@tripick/types';

import { useScheduleChange } from '@/entities/schedule-change';
import { Button, ModalShell } from '@/shared/ui';
import { useScheduleChangeActions } from '../model/use-schedule-change-actions';

type Props = {
  proposalId: string;
  /** 현재 여행 일정 항목(diff before 계산용) */
  tripItems: PlannerItineraryItemDto[];
  onClose: () => void;
};

/**
 * owner 가 참여자의 일정 변경 제안을 diff 로 확인하고 승인/거절하는 모달.
 * before(현재 일정)는 tripItems 에서, after 는 제안 payload 에서 계산한다.
 */
export function ScheduleChangePreviewModal({ proposalId, tripItems, onClose }: Props) {
  const { data: proposal, isPending } = useScheduleChange(proposalId);
  const { approve, reject } = useScheduleChangeActions(proposal?.tripId ?? '');
  const byId = useMemo(() => new Map(tripItems.map((i) => [i.id, i])), [tripItems]);

  const submitting = approve.isPending || reject.isPending;
  const resolved = proposal && proposal.status !== 'pending';

  return (
    <ModalShell
      label="일정 변경 요청 검토"
      onDismiss={submitting ? undefined : onClose}
      themed
      panelClassName="w-full max-w-[420px] rounded-[20px] bg-[color:var(--card,#fff)] p-5 shadow-[0_24px_60px_rgba(15,23,42,0.22)]"
    >
      <h2 className="text-[17px] font-bold text-[color:var(--ink,#191F28)]">일정 변경 요청 검토</h2>

      {isPending ? (
        <p className="mt-4 text-[14px] text-[color:var(--ink-faint,#8B95A1)]">불러오는 중…</p>
      ) : !proposal ? (
        <p className="mt-4 text-[14px] text-[color:var(--danger,#F04452)]">
          요청을 찾을 수 없어요.
        </p>
      ) : (
        <>
          <p className="mt-1.5 text-[13px] text-[color:var(--ink-sub,#6B7684)]">
            <span className="font-semibold text-[color:var(--ink,#191F28)]">
              {proposal.requester.nickname}
            </span>
            님의 요청 · {proposal.summary}
          </p>
          {resolved ? (
            <p className="mt-3 rounded-[12px] bg-[color:var(--card-soft,#F2F4F6)] px-3 py-2 text-[13px] font-semibold text-[color:var(--ink-sub,#6B7684)]">
              이미 처리된 요청이에요.
            </p>
          ) : (
            <div className="mt-4">
              <ProposalDiff payload={proposal.payload} byId={byId} />
            </div>
          )}

          {approve.error || reject.error ? (
            <p className="mt-3 rounded-[12px] border border-[color:var(--danger-border,#FECDD3)] bg-[color:var(--danger-tint,#FFECEE)] px-3 py-2 text-[13px] text-[color:var(--danger,#F04452)]">
              {((approve.error ?? reject.error) as Error).message}
            </p>
          ) : null}

          <div className="mt-5 flex gap-2">
            {resolved ? (
              <Button variant="primary" size="lg" className="flex-1" onClick={onClose}>
                닫기
              </Button>
            ) : (
              <>
                <Button
                  variant="secondary"
                  size="lg"
                  className="flex-1"
                  disabled={submitting}
                  onClick={() => reject.mutate(proposal.id, { onSuccess: onClose })}
                >
                  {reject.isPending ? '처리 중…' : '거절'}
                </Button>
                <Button
                  variant="primary"
                  size="lg"
                  className="flex-1"
                  disabled={submitting}
                  onClick={() => approve.mutate(proposal.id, { onSuccess: onClose })}
                >
                  {approve.isPending ? '반영 중…' : '승인'}
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </ModalShell>
  );
}

function ProposalDiff({
  payload,
  byId,
}: {
  payload: ScheduleChangePayload;
  byId: Map<string, PlannerItineraryItemDto>;
}) {
  switch (payload.kind) {
    case 'add_item':
      return (
        <DiffBox tone="add" label={`${payload.body.day}일차 추가`}>
          <div className="text-[14px] font-semibold text-[color:var(--ink,#191F28)]">
            {payload.body.name}
          </div>
          <div className="text-[12px] text-[color:var(--ink-sub,#6B7684)]">
            {payload.body.scheduledAt} 시작
          </div>
        </DiffBox>
      );
    case 'delete_item': {
      const item = byId.get(payload.itemId);
      return (
        <DiffBox tone="remove" label="삭제">
          <div className="text-[14px] font-semibold text-[color:var(--ink,#191F28)] line-through">
            {item?.name ?? '(이미 없는 항목)'}
          </div>
          {item ? (
            <div className="text-[12px] text-[color:var(--ink-sub,#6B7684)]">
              {item.scheduledAt} 시작
            </div>
          ) : null}
        </DiffBox>
      );
    }
    case 'swap': {
      const item = byId.get(payload.body.itemId);
      return (
        <DiffBox tone="change" label="대안 변경">
          <div className="flex items-center gap-2 text-[14px]">
            <span className="text-[color:var(--ink-faint,#8B95A1)] line-through">
              {item?.name ?? '기존 장소'}
            </span>
            <LuArrowRight
              className="size-4 shrink-0 text-[color:var(--primary,#3182F6)]"
              aria-hidden
            />
            <span className="font-semibold text-[color:var(--ink,#191F28)]">
              {payload.body.place.name}
            </span>
          </div>
        </DiffBox>
      );
    }
    case 'update_item': {
      const item = byId.get(payload.itemId);
      const rows: Array<{ label: string; before: string | undefined; after: string }> = [];
      const b = payload.body;
      if (b.name !== undefined) rows.push({ label: '이름', before: item?.name, after: b.name });
      if (b.scheduledAt !== undefined)
        rows.push({ label: '시간', before: item?.scheduledAt, after: b.scheduledAt });
      if (b.durationMin !== undefined)
        rows.push({
          label: '체류',
          before: item ? `${item.durationMin}분` : undefined,
          after: `${b.durationMin}분`,
        });
      if (b.memo !== undefined)
        rows.push({ label: '메모', before: item?.memo, after: b.memo || '(비움)' });
      return (
        <DiffBox tone="change" label={`${item?.name ?? '항목'} 수정`}>
          <div className="space-y-1">
            {rows.map((row) => (
              <div key={row.label} className="flex items-center gap-2 text-[13px]">
                <span className="w-8 shrink-0 text-[color:var(--ink-faint,#8B95A1)]">
                  {row.label}
                </span>
                <span className="text-[color:var(--ink-faint,#8B95A1)] line-through">
                  {row.before ?? '—'}
                </span>
                <LuArrowRight
                  className="size-3.5 shrink-0 text-[color:var(--primary,#3182F6)]"
                  aria-hidden
                />
                <span className="font-semibold text-[color:var(--ink,#191F28)]">{row.after}</span>
              </div>
            ))}
          </div>
        </DiffBox>
      );
    }
    case 'reorder_items': {
      const names = payload.body.orderedItemIds.map(
        (id, idx) => `${idx + 1}. ${byId.get(id)?.name ?? '(삭제된 항목)'}`,
      );
      return (
        <DiffBox tone="change" label={`${payload.body.day}일차 순서 변경`}>
          <ol className="space-y-0.5 text-[13px] text-[color:var(--ink,#191F28)]">
            {names.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ol>
        </DiffBox>
      );
    }
    case 'replan': {
      const targetDays = [...new Set(payload.body.targetDays ?? [])].sort((a, b) => a - b);
      const scopeLabel =
        targetDays.length > 0 ? `${targetDays.join('·')}일차 AI 재계획` : 'AI 재계획(전체 일정)';
      return (
        <DiffBox tone="change" label={scopeLabel}>
          <div className="text-[13px] text-[color:var(--ink-sub,#6B7684)]">
            {payload.body.note?.trim()
              ? `요청: “${payload.body.note.trim()}”`
              : targetDays.length > 0
                ? `AI가 ${targetDays.join('·')}일차만 다시 생성해요.`
                : 'AI가 일정 전체를 다시 생성해요.'}
          </div>
          <div className="mt-1 text-[12px] text-[color:var(--ink-faint,#8B95A1)]">
            승인하면 AI 재계획이 실행되고, 완료 시 일정에 반영돼요.
          </div>
        </DiffBox>
      );
    }
  }
}

function DiffBox({
  tone,
  label,
  children,
}: {
  tone: 'add' | 'remove' | 'change';
  label: string;
  children: React.ReactNode;
}) {
  const palette =
    tone === 'add'
      ? 'border-[color-mix(in_srgb,var(--ok,#00A86B)_34%,var(--card,#fff))] bg-[color-mix(in_srgb,var(--ok,#00A86B)_10%,var(--card,#fff))]'
      : tone === 'remove'
        ? 'border-[color:var(--danger-border,#FECDD3)] bg-[color:var(--danger-tint,#FFF5F6)]'
        : 'border-[color:var(--line-dot,#C7DCFF)] bg-[color:var(--primary-tint,#F5F9FF)]';
  const badge =
    tone === 'add'
      ? 'bg-[color-mix(in_srgb,var(--ok,#00A86B)_14%,var(--card,#fff))] text-[color:var(--ok,#00A86B)]'
      : tone === 'remove'
        ? 'bg-[color:var(--danger-tint,#FFECEE)] text-[color:var(--danger,#F04452)]'
        : 'bg-[color:var(--primary-tint,#EAF2FF)] text-[color:var(--primary-deep,#1B64DA)]';
  return (
    <div className={`rounded-[16px] border p-3.5 ${palette}`}>
      <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${badge}`}>
        {label}
      </span>
      <div className="mt-2">{children}</div>
    </div>
  );
}
