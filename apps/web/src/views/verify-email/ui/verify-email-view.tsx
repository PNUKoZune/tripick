'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';

import { verifyEmail } from '@/entities/session/api/auth-api';
import { AppFrame } from '@/shared/ui/app-frame';

export function VerifyEmailView() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const triggered = useRef(false);

  const mutation = useMutation({
    mutationFn: () => verifyEmail(token),
  });

  useEffect(() => {
    if (!token || triggered.current) return;
    triggered.current = true;
    mutation.mutate();
  }, [token, mutation]);

  return (
    <AppFrame showNav={false}>
      <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col justify-center px-5">
        <div className="text-center">
          <div className="text-[13px] font-black text-[#3182F6]">TriPick</div>
          <h1 className="mt-3 text-[24px] font-bold text-[#191F28]">이메일 인증</h1>
        </div>

        <div className="mt-8">
          {!token ? (
            <Block tone="error" title="잘못된 링크" body="토큰이 없는 링크에요. 인증 메일에서 다시 시도해주세요." />
          ) : mutation.isPending ? (
            <Block tone="info" title="인증 중…" body="잠시만 기다려주세요." />
          ) : mutation.isSuccess ? (
            <Block
              tone="success"
              title="인증이 완료됐어요"
              body="이제 로그인해서 여행을 시작해보세요."
              cta={{ href: '/login', label: '로그인하러 가기' }}
            />
          ) : mutation.isError ? (
            <Block
              tone="error"
              title="인증에 실패했어요"
              body={mutation.error instanceof Error ? mutation.error.message : '알 수 없는 오류'}
              cta={{ href: '/login', label: '로그인 페이지로' }}
            />
          ) : null}
        </div>
      </div>
    </AppFrame>
  );
}

function Block({
  tone,
  title,
  body,
  cta,
}: {
  tone: 'info' | 'success' | 'error';
  title: string;
  body: string;
  cta?: { href: string; label: string };
}) {
  const toneClass =
    tone === 'success'
      ? 'border-[#BCE9D6] bg-[#E5F7EE] text-[#00A86B]'
      : tone === 'error'
        ? 'border-[#FECDD3] bg-[#FFECEE] text-[#F04452]'
        : 'border-[#E5E8EB] bg-[#FAFBFC] text-[#191F28]';
  return (
    <div className={`rounded-[16px] border p-5 ${toneClass}`}>
      <h2 className="text-[16px] font-bold">{title}</h2>
      <p className="mt-2 text-[13px] leading-[20px] text-[#4E5968]">{body}</p>
      {cta ? (
        <Link
          href={cta.href}
          className="mt-3 inline-flex h-10 items-center rounded-[10px] bg-[#3182F6] px-4 text-[13px] font-bold text-white"
        >
          {cta.label}
        </Link>
      ) : null}
    </div>
  );
}
