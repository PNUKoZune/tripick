'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getKakaoStatus, redirectToKakao, startDemoSession } from '@/entities/session/api/auth-api';
import { PrimaryButton, SecondaryButton, InlineNotice } from '@/shared/ui/app-frame';

export function AuthStartActions() {
  const router = useRouter();
  const [loading, setLoading] = useState<'kakao' | 'demo' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleKakaoStart() {
    setLoading('kakao');
    setNotice(null);
    try {
      const status = await getKakaoStatus();
      if (status.ready) {
        redirectToKakao();
        return;
      }
      await startDemoSession();
      setNotice(
        '카카오 키가 들어오면 같은 버튼이 OAuth로 전환됩니다. 지금은 데모 세션으로 이어갑니다.',
      );
      router.push('/preferences');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '로그인을 시작하지 못했습니다.');
    } finally {
      setLoading(null);
    }
  }

  async function handleDemoStart() {
    setLoading('demo');
    setNotice(null);
    try {
      await startDemoSession();
      router.push('/preferences');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '데모 세션을 만들지 못했습니다.');
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-3">
      <PrimaryButton disabled={loading !== null} tone="kakao" onClick={handleKakaoStart}>
        {loading === 'kakao' ? '확인 중' : '카카오로 시작하기'}
      </PrimaryButton>
      <SecondaryButton disabled={loading !== null} onClick={handleDemoStart}>
        데모 세션으로 계속
      </SecondaryButton>
      {notice ? <InlineNotice title="로그인 준비 상태" description={notice} tone="blue" /> : null}
    </div>
  );
}
