'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LoginResponseDto } from '@tripick/types';
import Link from 'next/link';
import { redirectToKakao } from '@/entities/session/api/auth-api';
import { storeSession } from '@/entities/session/model/session-storage';
import { flushPendingFcmToken } from '@/entities/user';
import { AppFrame, InlineNotice, PrimaryButton } from '@/shared/ui/app-frame';

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
    const payload = hash.get('session');
    if (!payload) {
      setState({ status: 'error', message: '카카오 로그인 결과를 찾지 못했습니다.' });
      return;
    }

    try {
      const session = decodeSession(payload);
      storeSession(session);
      void flushPendingFcmToken();
      window.history.replaceState(null, '', '/auth/kakao/callback');
      router.replace('/');
    } catch {
      setState({ status: 'error', message: '카카오 로그인 정보를 저장하지 못했습니다.' });
    }
  }, [router]);

  return (
    <AppFrame showNav={false} themed>
      <section className="flex min-h-screen items-center justify-center px-5">
        <section className="w-full max-w-[360px]">
          <div className="text-[13px] font-black leading-5 text-[color:var(--blue-600)]">
            Tripick
          </div>
          <h1 className="mt-3 text-[30px] font-black leading-9">
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
                <PrimaryButton tone="kakao" onClick={redirectToKakao}>
                  카카오로 다시 시작
                </PrimaryButton>
                <Link
                  href="/login"
                  className="flex h-12 w-full items-center justify-center rounded-[14px] border border-[color:var(--line)] bg-[color:var(--card)] text-[14px] font-semibold text-[color:var(--ink)] hover:bg-[color:var(--card-soft)]"
                >
                  이메일로 로그인
                </Link>
              </>
            ) : (
              <div className="h-2 overflow-hidden rounded-full bg-[color:var(--soft-bg)]">
                <div className="h-full w-1/2 animate-pulse rounded-full bg-[color:var(--blue-600)]" />
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

function decodeSession(payload: string): LoginResponseDto {
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = window.atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const decoded = new TextDecoder().decode(bytes);
  const session = JSON.parse(decoded) as LoginResponseDto;
  if (!session.tokens?.accessToken || !session.tokens.refreshToken || !session.user?.id) {
    throw new Error('Invalid Kakao session payload');
  }
  return session;
}
