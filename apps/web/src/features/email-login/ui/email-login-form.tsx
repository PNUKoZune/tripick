'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { loginWithEmail } from '@/entities/session/api/auth-api';

type Props = {
  /** 로그인 성공 후 이동할 경로. default: '/' */
  next?: string;
};

export function EmailLoginForm({ next = '/' }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const mutation = useMutation({
    mutationFn: () => loginWithEmail({ email, password }),
    onSuccess: () => {
      queryClient.clear();
      router.replace(next);
    },
  });

  const canSubmit =
    email.trim().length > 0 && password.length > 0 && !mutation.isPending;

  const errorMessage = mutation.error instanceof Error ? mutation.error.message : null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) mutation.mutate();
      }}
      className="space-y-3"
    >
      <label className="block">
        <span className="mb-1 block text-[13px] font-bold text-[#191F28]">이메일</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          placeholder="you@example.com"
          className="h-12 w-full rounded-[12px] border border-[#E5E8EB] bg-white px-3 text-[15px] outline-none focus:border-[#3182F6]"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-[13px] font-bold text-[#191F28]">비밀번호</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          placeholder="••••••••"
          className="h-12 w-full rounded-[12px] border border-[#E5E8EB] bg-white px-3 text-[15px] outline-none focus:border-[#3182F6]"
        />
      </label>

      {errorMessage ? (
        <p className="text-[13px] font-semibold text-[#F04452]">{errorMessage}</p>
      ) : null}

      <button
        type="submit"
        disabled={!canSubmit}
        className="mt-2 h-12 w-full rounded-[12px] bg-[#3182F6] text-[15px] font-bold text-white hover:bg-[#1B64DA] disabled:bg-[#E5E8EB] disabled:text-[#B0B8C1]"
      >
        {mutation.isPending ? '로그인 중…' : '로그인'}
      </button>

      <div className="flex items-center justify-between pt-1 text-[13px]">
        <Link href="/forgot-password" className="font-semibold text-[#6B7684] hover:text-[#3182F6]">
          비밀번호를 잊으셨나요?
        </Link>
        <Link href="/signup" className="font-semibold text-[#3182F6] hover:underline">
          회원가입
        </Link>
      </div>
    </form>
  );
}
