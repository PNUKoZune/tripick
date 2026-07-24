'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FiChevronRight, FiUserX } from 'react-icons/fi';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { logout } from '@/entities/session/api/auth-api';
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
        onClick={() => {
          mutation.reset();
          onError?.(null);
          setOpen(true);
        }}
        className="mt-2 flex h-12 w-full items-center justify-between rounded-[12px] border border-[color:var(--danger-border,#FECDD3)] bg-[color:var(--card,#FFFFFF)] px-4 text-left text-[14px] font-bold text-[color:var(--danger,#F04452)] hover:bg-[color:var(--danger-tint,#FFECEE)]"
      >
        <span className="flex items-center gap-2">
          <FiUserX className="size-4" aria-hidden />
          회원 탈퇴
        </span>
        <FiChevronRight className="size-4" aria-hidden />
      </button>
      {open ? (
        <WithdrawalDialog
          pending={mutation.isPending}
          error={mutation.error instanceof Error ? mutation.error.message : null}
          onClose={() => setOpen(false)}
          onSubmit={(dto) => mutation.mutate(dto)}
        />
      ) : null}
    </>
  );
}
