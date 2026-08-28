'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { exchangeKakaoCode, redirectToKakao } from '@/entities/session/api/auth-api';
import { Button } from '@/shared/ui';
import { AppFrame, InlineNotice } from '@/shared/ui/app-frame';

type CallbackState = { status: 'checking' } | { status: 'error'; message: string };

export function KakaoCallbackView() {
  const router = useRouter();
  const [state, setState] = useState<CallbackState>({ status: 'checking' });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get('error');
    if (error) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 콜백 URL 파싱 결과를 마운트 시 반영
      setState({ status: 'error', message: normalizeCallbackError(error) });
      return;
    }

    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const exchangeCode = hash.get('code');
    if (!exchangeCode) {
      setState({ status: 'error', message: '카카오 로그인 결과를 찾지 못했습니다.' });
      return;
    }

    // 코드는 URL 에 잠깐 남으므로 교환 전에 먼저 지운다(뒤로 가기·히스토리에 안 남게).
    window.history.replaceState(null, '', '/auth/kakao/callback');
    exchangeKakaoCode(exchangeCode)
      .then(() => router.replace('/'))
      .catch((error: unknown) => {
        setState({
          status: 'error',
          message:
            error instanceof Error ? error.message : '카카오 로그인 정보를 저장하지 못했습니다.',
        });
      });
  }, [router]);

  function handleRetry() {
    redirectToKakao().catch((error: unknown) => {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : '로그인을 시작하지 못했습니다.',
      });
    });
  }

  return (
    <AppFrame showNav={false} themed>
      <section className="flex min-h-screen items-center justify-center px-5">
        <section className="w-full max-w-[360px]">
          <div className="text-[13px] font-extrabold leading-5 text-[color:var(--blue-600)]">
            TriPick
          </div>
          <h1 className="mt-3 text-[30px] font-extrabold leading-9">
            {state.status === 'checking' ? '로그인 확인 중' : '로그인을 완료하지 못했어요'}
          </h1>
          <p className="mt-3 text-[15px] font-bold leading-6 text-[color:var(--text-secondary)]">
            {state.status === 'checking'
              ? '카카오 계정 정보를 앱에 저장하고 있어요.'
              : '다시 시도하거나 이메일로 로그인할 수 있어요.'}
          </p>

          {state.status === 'error' ? (
            <div className="mt-6">
              <InlineNotice title="카카오 로그인 실패" description={state.message} tone="red" />
            </div>
          ) : null}

          <div className="mt-8 space-y-3">
            {state.status === 'error' ? (
              <>
                <Button variant="kakao" fullWidth onClick={handleRetry}>
                  카카오로 다시 시작
                </Button>
                <Link
                  href="/login"
                  className="flex h-12 w-full items-center justify-center rounded-[12px] border border-[color:var(--line)] bg-[color:var(--card)] text-[14px] font-semibold text-[color:var(--ink)] hover:bg-[color:var(--card-soft)]"
                >
                  이메일로 로그인
                </Link>
              </>
            ) : (
              <div className="h-2 overflow-hidden rounded-full bg-[color:var(--soft-bg)]">
                <div className="h-full w-1/2 motion-safe:animate-pulse rounded-full bg-[color:var(--blue-600)]" />
              </div>
            )}
          </div>
        </section>
      </section>
    </AppFrame>
  );
}

function normalizeCallbackError(message: string): string {
  if (message.trim().toLowerCase() === 'unauthorized') {
    return '카카오 인증을 완료하지 못했어요. REST API 키와 Client Secret 설정을 확인한 뒤 다시 시도해주세요.';
  }
  return message;
}

