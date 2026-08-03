'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { clearSession } from '@/entities/session';
import { resetPassword } from '@/entities/session/api/auth-api';
import { useRetryCountdown } from '@/shared/lib';

type Props = {
  token: string;
};

export function ResetPasswordForm({ token }: Props) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);

  const mutation = useMutation({
    mutationFn: () => resetPassword(token, password),
    onSuccess: () => {
      // 서버가 비밀번호 변경과 함께 refresh 토큰을 전부 폐기한다. 이 기기에 로그인 상태로
      // 남아 있으면 이미 죽은 세션이라, 나중에 401 로 튕기기 전에 여기서 비운다.
      clearSession();
      setDone(true);
    },
  });

  // 429 를 맞으면 Retry-After 만큼 재시도를 막는다(서버가 어차피 거절할 요청).
  const retryAfter = useRetryCountdown(mutation.error);

  if (done) {
    return (
      <div className="space-y-4">
        <div className="rounded-[16px] border border-[color:var(--line)] bg-[color:var(--card-soft)] p-5">
          <h2 className="text-[16px] font-bold text-[color:var(--ink)]">비밀번호 변경 완료</h2>
          <p className="mt-2 text-[13px] leading-[20px] text-[color:var(--ink-sub)]">
            새 비밀번호로 다시 로그인해주세요. 보안을 위해 다른 디바이스의 세션은 모두
            로그아웃됐어요.
          </p>
        </div>
        <Link
          href="/login"
          className="inline-flex h-12 w-full items-center justify-center rounded-[12px] bg-[color:var(--btn-bg)] text-[15px] font-bold text-[color:var(--btn-text)]"
        >
          로그인 페이지로
        </Link>
      </div>
    );
  }

  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit =
    password.length >= 8 && password === confirm && !mutation.isPending && retryAfter === 0;
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
        <span className="mb-1 block text-[13px] font-bold text-[color:var(--ink)]">새 비밀번호</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          className="h-12 w-full rounded-[12px] border border-[color:var(--line)] bg-[color:var(--card)] px-3 text-[15px] outline-none focus:border-[color:var(--primary)]"
        />
        <span className="mt-1 block text-[12px] text-[color:var(--ink-faint)]">8자 이상, 영문+숫자 포함</span>
      </label>
      <label className="block">
        <span className="mb-1 block text-[13px] font-bold text-[color:var(--ink)]">비밀번호 확인</span>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          className="h-12 w-full rounded-[12px] border border-[color:var(--line)] bg-[color:var(--card)] px-3 text-[15px] outline-none focus:border-[color:var(--primary)]"
        />
        {mismatch ? (
          <span className="mt-1 block text-[12px] font-semibold text-[color:var(--danger)]">
            비밀번호가 일치하지 않아요.
          </span>
        ) : null}
      </label>

      {errorMessage ? (
        <p className="text-[13px] font-semibold text-[color:var(--danger)]">{errorMessage}</p>
      ) : null}

      <button
        type="submit"
        disabled={!canSubmit}
        className="mt-2 h-12 w-full rounded-[12px] bg-[color:var(--btn-bg)] text-[15px] font-bold text-[color:var(--btn-text)] hover:bg-[color:var(--btn-bg-press)] disabled:bg-[color:var(--line)] disabled:text-[color:var(--ink-faint)]"
      >
        {mutation.isPending
          ? '변경 중…'
          : retryAfter > 0
            ? `${retryAfter}초 후 다시 시도`
            : '비밀번호 변경'}
      </button>
    </form>
  );
}
