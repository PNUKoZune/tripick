'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { requestPasswordReset } from '@/entities/session/api/auth-api';

export function RequestPasswordResetForm() {
  const [email, setEmail] = useState('');
  const [sentEmail, setSentEmail] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => requestPasswordReset(email),
    onSuccess: (res) => setSentEmail(res.email ?? email),
  });

  if (sentEmail) {
    return (
      <div className="rounded-[16px] border border-[#E5E8EB] bg-[#FAFBFC] p-5">
        <h2 className="text-[16px] font-bold text-[#191F28]">메일을 보냈어요</h2>
        <p className="mt-2 text-[13px] leading-[20px] text-[#4E5968]">
          <span className="font-bold text-[#191F28]">{sentEmail}</span> 으로 비밀번호 재설정 안내를
          보냈어요. 메일함을 확인해 1시간 안에 재설정해주세요.
        </p>
      </div>
    );
  }

  const canSubmit = email.trim().length > 0 && !mutation.isPending;
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
        <span className="mb-1 block text-[13px] font-bold text-[#191F28]">가입한 이메일</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          placeholder="you@example.com"
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
        {mutation.isPending ? '보내는 중…' : '재설정 메일 보내기'}
      </button>
    </form>
  );
}
