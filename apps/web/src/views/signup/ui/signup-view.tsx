'use client';

import Link from 'next/link';
import { useState } from 'react';

import { GuestGuard } from '@/entities/session';
import { resendVerification } from '@/entities/session/api/auth-api';
import { EmailSignupForm } from '@/features/email-signup';
import { useRetryCountdown } from '@/shared/lib';
import { LegalConsentStep } from '@/shared/ui';
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
  // 약관 동의가 가입 계약의 성립 요건이라(이용약관 제5조) 입력 폼보다 앞에 둔다.
  // 카카오도 같은 화면(LegalConsentStep)을 쓰되, 그쪽은 카카오 인증에서 돌아온 뒤에 뜬다.
  const [agreed, setAgreed] = useState(false);
  const [sentEmail, setSentEmail] = useState<string | null>(null);
  const resendMutation = useMutation({
    mutationFn: (email: string) => resendVerification(email),
  });
  // 재발송은 주소당 시간당 5회·IP 당 분당 3회라 429 가 실제로 난다. 결과를 안 그리면
  // 눌러도 아무 반응이 없어 사용자는 계속 누르고, 한도만 더 깎인다.
  const resendRetryAfter = useRetryCountdown(resendMutation.error);
  const resendError = resendMutation.error instanceof Error ? resendMutation.error.message : null;

  return (
    <AppFrame showNav={false} themed>
      <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col px-5 pb-[calc(40px+var(--safe-bottom))] pt-[calc(48px+var(--safe-top))]">
        <header className="mb-8">
          <div className="text-[13px] font-extrabold text-[color:var(--primary)]">TriPick</div>
          <h1 className="mt-2 text-[26px] font-bold text-[color:var(--ink)]">회원가입</h1>
          <p className="mt-1 text-[13px] text-[color:var(--ink-sub)]">
            {agreed || sentEmail
              ? '이메일로 가입하고 인증 메일을 확인하면 시작할 수 있어요.'
              : '약관에 동의하면 가입 정보를 입력할 수 있어요.'}
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
                disabled={resendMutation.isPending || resendRetryAfter > 0}
                className="mt-3 text-[13px] font-semibold text-[color:var(--primary)] hover:underline disabled:opacity-50"
              >
                {resendMutation.isPending
                  ? '재전송 중…'
                  : resendRetryAfter > 0
                    ? `${resendRetryAfter}초 후 다시 보낼 수 있어요`
                    : '인증 메일 다시 보내기'}
              </button>
              {resendMutation.isSuccess ? (
                <p className="mt-1 text-[12px] text-[color:var(--ok)]">메일이 재전송됐어요.</p>
              ) : null}
              {resendError ? (
                <p className="mt-1 text-[12px] font-semibold text-[color:var(--danger)]">
                  {resendError}
                </p>
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
            {agreed ? (
              <EmailSignupForm onSent={setSentEmail} />
            ) : (
              <LegalConsentStep from="signup" onAgree={() => setAgreed(true)} />
            )}
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
