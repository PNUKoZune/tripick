'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { logout } from '@/entities/session/api/auth-api';
import { deleteMe } from '@/entities/user';

type Props = {
  onError?: (error: Error | null) => void;
};

export function DeleteAccountButton({ onError }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: deleteMe,
    onSuccess: async () => {
      await logout();
      queryClient.clear();
      router.replace('/start');
      onError?.(null);
    },
    onError: (err) => onError?.(err instanceof Error ? err : null),
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 flex h-12 w-full items-center justify-between rounded-[12px] border border-[#FECDD3] bg-white px-4 text-left text-[14px] font-bold text-[#F04452] hover:bg-[#FFECEE]"
      >
        <span>회원 탈퇴</span>
        <span className="text-[12px]">→</span>
      </button>
      {open ? (
        <ConfirmDialog
          pending={mutation.isPending}
          onCancel={() => setOpen(false)}
          onConfirm={() => mutation.mutate()}
        />
      ) : null}
    </>
  );
}

function ConfirmDialog({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      onClick={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-5"
    >
      <div className="w-full max-w-[400px] rounded-[20px] bg-white p-5 shadow-[0_24px_60px_rgba(15,23,42,0.22)]">
        <h2 className="text-[18px] font-bold text-[#191F28]">정말 탈퇴할까요?</h2>
        <p className="mt-2 text-[13px] leading-[20px] text-[#4E5968]">
          여행 일정, 친구 목록, 받은 알림이 모두 삭제됩니다. 이 작업은 되돌릴 수 없어요.
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
            {pending ? '처리 중…' : '탈퇴하기'}
          </button>
        </div>
      </div>
    </div>
  );
}
