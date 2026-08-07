'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { NICKNAME_MAX_LENGTH } from '@tripick/types';

import { signupWithEmail } from '@/entities/session/api/auth-api';
import { useRetryCountdown } from '@/shared/lib';

type Props = {
  onSent?: (email: string) => void;
};

export function EmailSignupForm({ onSent }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');

  const mutation = useMutation({
    mutationFn: () => signupWithEmail({ email, password, nickname }),
    onSuccess: (res) => onSent?.(res.email ?? email),
  });

  // 429 를 맞으면 Retry-After 만큼 재시도를 막는다(서버가 어차피 거절할 요청).
  const retryAfter = useRetryCountdown(mutation.error);
  const canSubmit =
    email.trim().length > 0 &&
    password.length >= 8 &&
    nickname.trim().length > 0 &&
    !mutation.isPending &&
    retryAfter === 0;

  const errorMessage = mutation.error instanceof Error ? mutation.error.message : null;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) mutation.mutate();
      }}
      className="space-y-3"
    >
      <Field label="닉네임">
        <input
          type="text"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          maxLength={NICKNAME_MAX_LENGTH}
          placeholder="여행자"
          className="h-12 w-full rounded-[12px] border border-[color:var(--line)] bg-[color:var(--card)] px-3 text-[15px] outline-none focus:border-[color:var(--primary)]"
        />
      </Field>
      <Field label="이메일">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          placeholder="you@example.com"
          className="h-12 w-full rounded-[12px] border border-[color:var(--line)] bg-[color:var(--card)] px-3 text-[15px] outline-none focus:border-[color:var(--primary)]"
        />
      </Field>
      <Field label="비밀번호" hint="8자 이상, 영문+숫자 포함">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          placeholder="••••••••"
          className="h-12 w-full rounded-[12px] border border-[color:var(--line)] bg-[color:var(--card)] px-3 text-[15px] outline-none focus:border-[color:var(--primary)]"
        />
      </Field>

      {errorMessage ? (
        <p className="text-[13px] font-semibold text-[color:var(--danger)]">{errorMessage}</p>
      ) : null}

      <button
        type="submit"
        disabled={!canSubmit}
        className="mt-2 h-12 w-full rounded-[12px] bg-[color:var(--btn-bg)] text-[15px] font-bold text-[color:var(--btn-text)] hover:bg-[color:var(--btn-bg-press)] disabled:bg-[color:var(--line)] disabled:text-[color:var(--ink-faint)]"
      >
        {mutation.isPending ? '가입 중…' : retryAfter > 0 ? `${retryAfter}초 후 다시 시도` : '회원가입'}
      </button>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] font-bold text-[color:var(--ink)]">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[12px] text-[color:var(--ink-faint)]">{hint}</span> : null}
    </label>
  );
}
