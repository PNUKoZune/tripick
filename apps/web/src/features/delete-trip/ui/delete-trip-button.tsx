'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FiChevronRight, FiTrash2 } from 'react-icons/fi';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { deleteTrip } from '@/entities/trip-plan';
import { queryKeys } from '@/shared/api/query-keys';
import { ModalShell } from '@/shared/ui';

type Props = {
  tripId: string;
  tripTitle: string;
  /** 버튼 스타일 변형. `menu` 는 목록형(설정 화면), `compact` 는 헤더 아이콘형 */
  variant?: 'menu' | 'compact';
  onError?: (error: Error | null) => void;
};

export function DeleteTripButton({ tripId, tripTitle, variant = 'menu', onError }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: () => deleteTrip(tripId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.planner.trips });
      queryClient.removeQueries({ queryKey: queryKeys.planner.trip(tripId) });
      onError?.(null);
      setOpen(false);
      router.replace('/trips');
    },
    onError: (err) => onError?.(err instanceof Error ? err : null),
  });

  return (
    <>
      {variant === 'compact' ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="이 여행 삭제"
          className="flex h-9 items-center gap-1 rounded-[12px] border border-[color:var(--danger-border,#FECDD3)] bg-[color:var(--card,#FFFFFF)] px-3 text-[13px] font-semibold text-[color:var(--danger,#F04452)] hover:bg-[color:var(--danger-tint,#FFECEE)]"
        >
          <FiTrash2 className="size-4" aria-hidden />
          <span className="hidden sm:inline">삭제</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-12 w-full items-center justify-between rounded-[12px] border border-[color:var(--danger-border,#FECDD3)] bg-[color:var(--card,#FFFFFF)] px-4 text-left text-[14px] font-bold text-[color:var(--danger,#F04452)] hover:bg-[color:var(--danger-tint,#FFECEE)]"
        >
          <span className="flex items-center gap-2">
            <FiTrash2 className="size-4" aria-hidden />
            이 여행 삭제
          </span>
          <FiChevronRight className="size-4" aria-hidden />
        </button>
      )}
      {open ? (
        <ConfirmDialog
          tripTitle={tripTitle}
          pending={mutation.isPending}
          onCancel={() => {
            if (!mutation.isPending) setOpen(false);
          }}
          onConfirm={() => mutation.mutate()}
        />
      ) : null}
    </>
  );
}

function ConfirmDialog({
  tripTitle,
  pending,
  onCancel,
  onConfirm,
}: {
  tripTitle: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalShell
      label="이 여행을 삭제할까요?"
      onDismiss={pending ? undefined : onCancel}
      panelClassName="w-full max-w-[400px] rounded-[20px] bg-[color:var(--card,#FFFFFF)] p-5 shadow-[0_24px_60px_rgba(15,23,42,0.22)]"
    >
      <h2 className="text-[18px] font-bold text-[color:var(--ink,#191F28)]">이 여행을 삭제할까요?</h2>
      <p className="mt-2 text-[13px] leading-[20px] text-[color:var(--ink-sub,#4E5968)]">
        &ldquo;{tripTitle}&rdquo; 의 일정, 지도, 취향 조율 결과가 모두 삭제됩니다. 이 작업은 되돌릴
        수 없어요.
      </p>
      <div className="mt-5 flex items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="h-11 flex-1 rounded-[12px] border border-[color:var(--line,#E5E8EB)] bg-[color:var(--card,#FFFFFF)] text-[14px] font-bold text-[color:var(--ink-sub,#6B7684)] hover:bg-[color:var(--card-soft,#FAFBFC)] disabled:opacity-50"
        >
          취소
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className="h-11 flex-1 rounded-[12px] bg-[color:var(--danger,#F04452)] text-[14px] font-bold text-[color:var(--btn-text,#FFFFFF)] hover:brightness-95 disabled:opacity-50"
        >
          {pending ? '삭제 중…' : '삭제하기'}
        </button>
      </div>
    </ModalShell>
  );
}
