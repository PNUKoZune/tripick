'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
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
      className="flex h-12 w-full items-center justify-between rounded-[12px] border border-[#E5E8EB] bg-white px-4 text-left text-[14px] font-bold text-[#191F28] hover:bg-[#FAFBFC] disabled:opacity-50"
    >
      <span>로그아웃</span>
      <span className="text-[12px] text-[#8B95A1]">{pending ? '진행 중…' : '→'}</span>
    </button>
  );
}
