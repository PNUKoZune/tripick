'use client';

import Link from 'next/link';

import { GuestGuard } from '@/entities/session';
import { RequestPasswordResetForm } from '@/features/request-password-reset';
import { AppFrame } from '@/shared/ui/app-frame';

export function ForgotPasswordView() {
  return (
    <GuestGuard>
      <ForgotPasswordContent />
    </GuestGuard>
  );
}

function ForgotPasswordContent() {
  return (
    <AppFrame showNav={false} themed>
      <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col px-5 pb-10 pt-12">
        <header className="mb-8">
          <div className="text-[13px] font-black text-[color:var(--primary)]">TriPick</div>
          <h1 className="mt-2 text-[26px] font-bold text-[color:var(--ink)]">비밀번호 찾기</h1>
          <p className="mt-1 text-[13px] text-[color:var(--ink-sub)]">
            가입한 이메일로 재설정 링크를 보내드려요.
          </p>
        </header>

        <RequestPasswordResetForm />

        <div className="mt-6 text-center text-[13px] text-[color:var(--ink-sub)]">
          <Link href="/login" className="font-semibold text-[color:var(--primary)] hover:underline">
            로그인으로 돌아가기
          </Link>
        </div>
      </div>
    </AppFrame>
  );
}
