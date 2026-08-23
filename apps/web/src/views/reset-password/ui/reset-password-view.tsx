'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { ResetPasswordForm } from '@/features/reset-password';
import { AppFrame } from '@/shared/ui/app-frame';

export function ResetPasswordView() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';

  return (
    <AppFrame showNav={false} themed>
      <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col px-5 pb-10 pt-12">
        <header className="mb-8">
          <div className="text-[13px] font-extrabold text-[color:var(--primary)]">TriPick</div>
          <h1 className="mt-2 text-[26px] font-bold text-[color:var(--ink)]">새 비밀번호 설정</h1>
        </header>

        {token ? (
          <ResetPasswordForm token={token} />
        ) : (
          <div className="rounded-[16px] border border-[color:var(--danger-border)] bg-[color:var(--danger-tint)] p-5">
            <h2 className="text-[15px] font-bold text-[color:var(--danger)]">잘못된 링크</h2>
            <p className="mt-2 text-[13px] leading-[20px] text-[color:var(--ink-sub)]">
              토큰이 없거나 만료된 링크에요. 비밀번호 재설정을 다시 요청해주세요.
            </p>
            <Link
              href="/forgot-password"
              className="mt-3 inline-flex h-10 items-center rounded-[12px] bg-[color:var(--danger-deep)] px-4 text-[13px] font-bold text-[color:var(--danger-on)]"
            >
              다시 요청하기
            </Link>
          </div>
        )}
      </div>
    </AppFrame>
  );
}
