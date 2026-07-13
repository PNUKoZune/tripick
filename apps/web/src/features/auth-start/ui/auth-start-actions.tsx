'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getKakaoStatus, redirectToKakao, startDemoSession } from '@/entities/session/api/auth-api';
import { InlineNotice, PrimaryButton, SecondaryButton } from '@/shared/ui/app-frame';

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
      const missingKeys = status.missingKeys?.join(', ') || 'KAKAO_REST_API_KEY, KAKAO_CALLBACK_URL';
      setNotice(`카카오 로그인 환경 변수가 필요해요: ${missingKeys}`);
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
      router.push('/');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '임시 세션을 만들지 못했습니다.');
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-3">
      <Link
        href="/signup"
        className="flex h-14 w-full items-center justify-center rounded-[16px] bg-[#3182F6] text-[16px] font-black text-white hover:bg-[#1B64DA]"
      >
        이메일로 회원가입
      </Link>
      <Link
        href="/login"
        className="flex h-12 w-full items-center justify-center rounded-[16px] border border-[#E5E8EB] bg-white text-[15px] font-black text-[#191F28] hover:bg-[#FAFBFC]"
      >
        이메일로 로그인
      </Link>

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-[#E5E8EB]" />
        <span className="text-[12px] font-semibold text-[#8B95A1]">또는</span>
        <div className="h-px flex-1 bg-[#E5E8EB]" />
      </div>

      <PrimaryButton disabled={loading !== null} tone="kakao" onClick={handleKakaoStart}>
        {loading === 'kakao' ? '확인 중' : '카카오로 계속하기'}
      </PrimaryButton>
      <SecondaryButton disabled={loading !== null} onClick={handleDemoStart}>
        {loading === 'demo' ? '준비 중…' : '임시 세션으로 둘러보기'}
      </SecondaryButton>
      {notice ? <InlineNotice title="로그인 준비 상태" description={notice} tone="blue" /> : null}
    </div>
  );
}
