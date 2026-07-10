'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { deleteTrip } from '@/entities/trip-plan';
import { queryKeys } from '@/shared/api/query-keys';

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
          className="flex h-9 items-center gap-1 rounded-[12px] border border-[#FECDD3] bg-white px-3 text-[13px] font-semibold text-[#F04452] hover:bg-[#FFECEE]"
        >
          <span aria-hidden>🗑</span>
          <span className="hidden sm:inline">삭제</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-12 w-full items-center justify-between rounded-[12px] border border-[#FECDD3] bg-white px-4 text-left text-[14px] font-bold text-[#F04452] hover:bg-[#FFECEE]"
        >
          <span>이 여행 삭제</span>
          <span className="text-[12px]">→</span>
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
    <div
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-5"
    >
      <div className="w-full max-w-[400px] rounded-[20px] bg-white p-5 shadow-[0_24px_60px_rgba(15,23,42,0.22)]">
        <h2 className="text-[18px] font-bold text-[#191F28]">이 여행을 삭제할까요?</h2>
        <p className="mt-2 text-[13px] leading-[20px] text-[#4E5968]">
          &ldquo;{tripTitle}&rdquo; 의 일정, 지도, 취향 조율 결과가 모두 삭제됩니다. 이 작업은 되돌릴
          수 없어요.
        </p>
        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="h-11 flex-1 rounded-[12px] border border-[#E5E8EB] bg-white text-[14px] font-bold text-[#6B7684] hover:bg-[#FAFBFC] disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="h-11 flex-1 rounded-[12px] bg-[#F04452] text-[14px] font-bold text-white hover:bg-[#D93645] disabled:opacity-50"
          >
            {pending ? '삭제 중…' : '삭제하기'}
          </button>
        </div>
      </div>
    </div>
  );
}
