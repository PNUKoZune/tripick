'use client';

import Link from 'next/link';
import { useState } from 'react';

import { GuestGuard } from '@/entities/session';
import { resendVerification } from '@/entities/session/api/auth-api';
import { EmailSignupForm } from '@/features/email-signup';
import { AppFrame } from '@/shared/ui/app-frame';
import { useMutation } from '@tanstack/react-query';

export function SignupView() {
  return (
    <GuestGuard>
      <SignupContent />
    </GuestGuard>
  );
}

function SignupContent() {
  const [sentEmail, setSentEmail] = useState<string | null>(null);
  const resendMutation = useMutation({
    mutationFn: (email: string) => resendVerification(email),
  });

  return (
    <AppFrame showNav={false} themed>
      <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col px-5 pb-10 pt-12">
        <header className="mb-8">
          <div className="text-[13px] font-black text-[color:var(--primary)]">TriPick</div>
          <h1 className="mt-2 text-[26px] font-bold text-[color:var(--ink)]">회원가입</h1>
          <p className="mt-1 text-[13px] text-[color:var(--ink-sub)]">
            이메일로 가입하고 인증 메일을 확인하면 시작할 수 있어요.
          </p>
        </header>

        {sentEmail ? (
          <div className="space-y-4">
            <div className="rounded-[16px] border border-[color:var(--line)] bg-[color:var(--card-soft)] p-5">
              <h2 className="text-[16px] font-bold text-[color:var(--ink)]">인증 메일을 보냈어요</h2>
              <p className="mt-2 text-[13px] leading-[20px] text-[color:var(--ink-sub)]">
                <span className="font-bold text-[color:var(--ink)]">{sentEmail}</span> 의 메일함을 확인해
                인증을 완료해주세요. (24시간 안에)
              </p>
              <button
                type="button"
                onClick={() => resendMutation.mutate(sentEmail)}
                disabled={resendMutation.isPending}
                className="mt-3 text-[13px] font-semibold text-[color:var(--primary)] hover:underline disabled:opacity-50"
              >
                {resendMutation.isPending ? '재전송 중…' : '인증 메일 다시 보내기'}
              </button>
              {resendMutation.isSuccess ? (
                <p className="mt-1 text-[12px] text-[color:var(--ok)]">메일이 재전송됐어요.</p>
              ) : null}
            </div>
            <Link
              href="/login"
              className="inline-flex h-12 w-full items-center justify-center rounded-[12px] border border-[color:var(--line)] bg-[color:var(--card)] text-[15px] font-bold text-[color:var(--ink)] hover:bg-[color:var(--card-soft)]"
            >
              로그인 페이지로
            </Link>
          </div>
        ) : (
          <>
            <EmailSignupForm onSent={setSentEmail} />
            <div className="mt-6 text-center text-[13px] text-[color:var(--ink-sub)]">
              이미 계정이 있나요?{' '}
              <Link href="/login" className="font-semibold text-[color:var(--primary)] hover:underline">
                로그인
              </Link>
            </div>
          </>
        )}
      </div>
    </AppFrame>
  );
}
