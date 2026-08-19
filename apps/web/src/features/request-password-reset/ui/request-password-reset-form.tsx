'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { requestPasswordReset } from '@/entities/session/api/auth-api';
import { useRetryCountdown } from '@/shared/lib';

export function RequestPasswordResetForm() {
  const [email, setEmail] = useState('');
  const [sentEmail, setSentEmail] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => requestPasswordReset(email),
    onSuccess: (res) => setSentEmail(res.email ?? email),
  });

  // 메일 발송은 분당 3회라 429 가 가장 잘 나는 화면. Retry-After 만큼 재시도를 막는다.
  const retryAfter = useRetryCountdown(mutation.error);

  if (sentEmail) {
    return (
      <div className="rounded-[16px] border border-[color:var(--line)] bg-[color:var(--card-soft)] p-5">
        <h2 className="text-[16px] font-bold text-[color:var(--ink)]">메일을 보냈어요</h2>
        <p className="mt-2 text-[13px] leading-[20px] text-[color:var(--ink-sub)]">
          <span className="font-bold text-[color:var(--ink)]">{sentEmail}</span> 으로 비밀번호
          재설정 안내를 보냈어요. 메일함을 확인해 1시간 안에 재설정해주세요.
        </p>
      </div>
    );
  }

  const canSubmit = email.trim().length > 0 && !mutation.isPending && retryAfter === 0;
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
        <span className="mb-1 block text-[13px] font-bold text-[color:var(--ink)]">
          가입한 이메일
        </span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          placeholder="you@example.com"
          className="h-12 w-full rounded-[12px] border border-[color:var(--line)] bg-[color:var(--card)] px-3 text-[15px] outline-none focus:border-[color:var(--primary)]"
        />
      </label>
      {errorMessage ? (
        <p role="alert" className="text-[13px] font-semibold text-[color:var(--danger)]">
          {errorMessage}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={!canSubmit}
        className="mt-2 h-12 w-full rounded-[12px] bg-[color:var(--btn-bg)] text-[15px] font-bold text-[color:var(--btn-text)] hover:bg-[color:var(--btn-bg-press)] disabled:bg-[color:var(--line)] disabled:text-[color:var(--ink-faint)]"
      >
        {mutation.isPending
          ? '보내는 중…'
          : retryAfter > 0
            ? `${retryAfter}초 후 다시 시도`
            : '재설정 메일 보내기'}
      </button>
    </form>
  );
}
