'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LuChevronRight, LuUserX } from 'react-icons/lu';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { clearLocalSession } from '@/entities/session/api/auth-api';
import { withdrawMe, type WithdrawUserDto } from '@/entities/user';
import { WithdrawalDialog } from './withdrawal-dialog';

type Props = {
  onError?: (error: Error | null) => void;
};

export function DeleteAccountButton({ onError }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: (dto: WithdrawUserDto) => withdrawMe(dto),
    onSuccess: () => {
      // 서버는 탈퇴 처리에서 계정·세션·FCM 토큰을 이미 지웠다. 로컬만 비우면 된다.
      clearLocalSession();
      queryClient.clear();
      router.replace('/start');
      onError?.(null);
    },
    onError: (err) => onError?.(err instanceof Error ? err : null),
  });

  /** 다이얼로그를 여닫을 때 남은 에러까지 치운다 — 설정 페이지 배너에 그대로 남지 않도록. */
  const setDialog = (next: boolean) => {
    mutation.reset();
    onError?.(null);
    setOpen(next);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setDialog(true)}
        className="mt-2 flex h-12 w-full items-center justify-between rounded-[12px] border border-[color:var(--danger-border,#FECDD3)] bg-[color:var(--card,#FFFFFF)] px-4 text-left text-[14px] font-bold text-[color:var(--danger,#F04452)] hover:bg-[color:var(--danger-tint,#FFECEE)]"
      >
        <span className="flex items-center gap-2">
          <LuUserX className="size-4" aria-hidden />
          회원 탈퇴
        </span>
        <LuChevronRight className="size-4" aria-hidden />
      </button>
      {open ? (
        <WithdrawalDialog
          pending={mutation.isPending}
          error={mutation.error instanceof Error ? mutation.error.message : null}
          onClose={() => setDialog(false)}
          onSubmit={(dto) => mutation.mutate(dto)}
        />
      ) : null}
    </>
  );
}
