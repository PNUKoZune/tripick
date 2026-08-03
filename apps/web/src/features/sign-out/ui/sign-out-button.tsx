'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LuChevronRight, LuLogOut } from 'react-icons/lu';
import { useQueryClient } from '@tanstack/react-query';

import { logout } from '@/entities/session/api/auth-api';
import { disconnectRealtimeSocket } from '@/shared/realtime';

export function SignOutButton() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    try {
      await logout();
      disconnectRealtimeSocket();
      queryClient.clear();
      router.replace('/start');
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="flex h-12 w-full items-center justify-between rounded-[12px] border border-[color:var(--line)] bg-[color:var(--card)] px-4 text-left text-[14px] font-bold text-[color:var(--ink)] hover:bg-[color:var(--card-soft)] disabled:opacity-50"
    >
      <span className="flex items-center gap-2">
        <LuLogOut className="size-4 text-[color:var(--ink-faint)]" aria-hidden />
        로그아웃
      </span>
      {pending ? (
        <span className="text-[12px] text-[color:var(--ink-faint)]">진행 중…</span>
      ) : (
        <LuChevronRight className="size-4 text-[color:var(--ink-faint)]" aria-hidden />
      )}
    </button>
  );
}
