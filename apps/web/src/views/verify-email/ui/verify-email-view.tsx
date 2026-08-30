'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { verifyEmail } from '@/entities/session/api/auth-api';
import { AppFrame } from '@/shared/ui/app-frame';

type VerifyState =
  | { status: 'pending' }
  | { status: 'success' }
  | { status: 'error'; message: string };

export function VerifyEmailView() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const triggered = useRef(false);
  const [state, setState] = useState<VerifyState>({ status: 'pending' });

  // 결과를 컴포넌트 state 로 들고 있는다 — `useMutation` 을 쓰면 개발 모드에서 화면이
  // "인증 중…" 에 멈춘다. StrictMode 가 마운트 직후 effect 를 한 번 정리하는데,
  // react-query 의 MutationObserver 는 구독이 끊길 때 진행 중인 mutation 에서 자신을
  // 떼어내고 다시 붙지 않아, 서버 인증이 끝나도 결과가 화면에 오지 않는다.
  useEffect(() => {
    if (!token || triggered.current) return;
    triggered.current = true;
    verifyEmail(token)
      .then(() => setState({ status: 'success' }))
      .catch((error: unknown) => {
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : '알 수 없는 오류',
        });
      });
  }, [token]);

  return (
    <AppFrame showNav={false} themed>
      <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col justify-center px-5">
        <div className="text-center">
          <div className="text-[13px] font-extrabold text-[color:var(--primary)]">TriPick</div>
          <h1 className="mt-3 text-[24px] font-bold text-[color:var(--ink)]">이메일 인증</h1>
        </div>

        <div className="mt-8">
          {!token ? (
            <Block tone="error" title="잘못된 링크" body="토큰이 없는 링크에요. 인증 메일에서 다시 시도해주세요." />
          ) : state.status === 'pending' ? (
            <Block tone="info" title="인증 중…" body="잠시만 기다려주세요." />
          ) : state.status === 'success' ? (
            <Block
              tone="success"
              title="인증이 완료됐어요"
              body="이제 로그인해서 여행을 시작해보세요."
              cta={{ href: '/login', label: '로그인하러 가기' }}
            />
          ) : (
            <Block
              tone="error"
              title="인증에 실패했어요"
              body={state.message}
              cta={{ href: '/login', label: '로그인 페이지로' }}
            />
          )}
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
      ? 'border-[color:var(--ok)]/40 bg-[color:var(--ok)]/12 text-[color:var(--ok)]'
      : tone === 'error'
        ? 'border-[color:var(--danger-border)] bg-[color:var(--danger-tint)] text-[color:var(--danger)]'
        : 'border-[color:var(--line)] bg-[color:var(--card-soft)] text-[color:var(--ink)]';
  return (
    <div className={`rounded-[16px] border p-5 ${toneClass}`}>
      <h2 className="text-[16px] font-bold">{title}</h2>
      <p className="mt-2 text-[13px] leading-[20px] text-[color:var(--ink-sub)]">{body}</p>
      {cta ? (
        <Link
          href={cta.href}
          className="mt-3 inline-flex h-10 items-center rounded-[12px] bg-[color:var(--btn-bg)] px-4 text-[13px] font-bold text-[color:var(--btn-text)]"
        >
          {cta.label}
        </Link>
      ) : null}
    </div>
  );
}
