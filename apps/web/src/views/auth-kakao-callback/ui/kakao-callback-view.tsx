'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  completeKakaoSignup,
  exchangeKakaoCode,
  redirectToKakao,
} from '@/entities/session/api/auth-api';
import { Button, LegalConsentStep } from '@/shared/ui';
import { AppFrame, InlineNotice } from '@/shared/ui/app-frame';
import {
  clearPendingKakaoConsent,
  readPendingKakaoConsent,
  writePendingKakaoConsent,
  type PendingKakaoConsent,
} from '../model/pending-consent';

type CallbackState =
  | { status: 'checking' }
  | { status: 'consent'; pending: PendingKakaoConsent }
  | { status: 'error'; message: string };

export function KakaoCallbackView() {
  const router = useRouter();
  const [state, setState] = useState<CallbackState>({ status: 'checking' });
  const [submitting, setSubmitting] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);

  useEffect(() => {
    // 약관 전문을 보고 돌아온 경우. 교환은 이미 끝났고 동의만 남았다 — 다시 교환하면
    // 코드가 이미 소비돼 실패한다.
    const resumed = readPendingKakaoConsent();
    if (resumed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 저장된 진행 상태·URL 파싱 결과를 반영
      setState({ status: 'consent', pending: resumed });
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const error = params.get('error');
    if (error) {
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
      .then((result) => {
        if (result.status === 'ok') {
          router.replace('/');
          return;
        }
        // 처음 오는 사람 — 서버에 계정이 아직 없다. 동의를 받아야 만들어진다.
        const pending: PendingKakaoConsent = {
          consentCode: result.consentCode,
          ...(result.nickname ? { nickname: result.nickname } : {}),
        };
        writePendingKakaoConsent(pending);
        setState({ status: 'consent', pending });
      })
      .catch((error: unknown) => {
        setState({
          status: 'error',
          message:
            error instanceof Error ? error.message : '카카오 로그인 정보를 저장하지 못했습니다.',
        });
      });
  }, [router]);

  function handleRetry() {
    clearPendingKakaoConsent();
    redirectToKakao().catch((error: unknown) => {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : '로그인을 시작하지 못했습니다.',
      });
    });
  }

  function handleAgree() {
    if (state.status !== 'consent' || submitting) return;
    setSubmitting(true);
    setConsentError(null);
    completeKakaoSignup(state.pending.consentCode)
      .then(() => {
        clearPendingKakaoConsent();
        router.replace('/');
      })
      .catch((error: unknown) => {
        setSubmitting(false);
        setConsentError(
          error instanceof Error ? error.message : '가입을 완료하지 못했습니다. 다시 시도해주세요.',
        );
      });
  }

  function handleCancel() {
    clearPendingKakaoConsent();
    router.replace('/login');
  }

  if (state.status === 'consent') {
    return (
      <AppFrame showNav={false} themed>
        <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col px-5 pb-[calc(40px+var(--safe-bottom))] pt-[calc(48px+var(--safe-top))]">
          <header className="mb-8">
            <div className="text-[13px] font-extrabold text-[color:var(--primary)]">TriPick</div>
            <h1 className="mt-2 text-[26px] font-bold text-[color:var(--ink)]">약관에 동의해주세요</h1>
            <p className="mt-1 text-[13px] leading-[20px] text-[color:var(--ink-sub)]">
              {state.pending.nickname
                ? `${state.pending.nickname} 님, 동의하시면 계정을 만들어 드릴게요.`
                : '동의하시면 계정을 만들어 드릴게요.'}{' '}
              동의 전에는 계정이 만들어지지 않아요.
            </p>
          </header>

          <LegalConsentStep
            submitLabel="동의하고 가입 완료"
            pending={submitting}
            error={consentError}
            onAgree={handleAgree}
            footer={
              <button
                type="button"
                onClick={handleCancel}
                className="mt-1 w-full text-center text-[13px] font-semibold text-[color:var(--ink-sub)] hover:underline"
              >
                가입하지 않고 나가기
              </button>
            }
          />
        </div>
      </AppFrame>
    );
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
