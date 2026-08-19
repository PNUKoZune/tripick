'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { loginWithEmail } from '@/entities/session/api/auth-api';
import { useRetryCountdown } from '@/shared/lib';
import { Button } from '@/shared/ui';

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

  // 429 를 맞으면 Retry-After 만큼 재시도를 막는다(서버가 어차피 거절할 요청).
  const retryAfter = useRetryCountdown(mutation.error);
  const canSubmit =
    email.trim().length > 0 && password.length > 0 && !mutation.isPending && retryAfter === 0;

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
        <span className="mb-1 block text-[13px] font-bold text-[color:var(--ink)]">이메일</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          placeholder="you@example.com"
          className="h-12 w-full rounded-[12px] border border-[color:var(--line)] bg-[color:var(--card)] px-3 text-[15px] outline-none focus:border-[color:var(--primary)]"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-[13px] font-bold text-[color:var(--ink)]">비밀번호</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          placeholder="••••••••"
          className="h-12 w-full rounded-[12px] border border-[color:var(--line)] bg-[color:var(--card)] px-3 text-[15px] outline-none focus:border-[color:var(--primary)]"
        />
      </label>

      {errorMessage ? (
        <p role="alert" className="text-[13px] font-semibold text-[color:var(--danger)]">
          {errorMessage}
        </p>
      ) : null}

      <Button type="submit" size="md" fullWidth className="mt-2" disabled={!canSubmit}>
        {mutation.isPending
          ? '로그인 중…'
          : retryAfter > 0
            ? `${retryAfter}초 후 다시 시도`
            : '로그인'}
      </Button>

      <div className="flex items-center justify-between pt-1 text-[13px]">
        <Link
          href="/forgot-password"
          className="font-semibold text-[color:var(--ink-sub)] hover:text-[color:var(--primary)]"
        >
          비밀번호를 잊으셨나요?
        </Link>
        <Link href="/signup" className="font-semibold text-[color:var(--primary)] hover:underline">
          회원가입
        </Link>
      </div>
    </form>
  );
}
