'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getKakaoStatus, redirectToKakao, startDemoSession } from '@/entities/session/api/auth-api';
import { InlineNotice } from '@/shared/ui/app-frame';

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
      {/* 로그인 없이 체험 — 헤더 배지·하단 캡션과 일치하는 실제 primary CTA
          (목업의 단일 버튼 위계를 실제 4-경로 인증에 맞게 재구성: REQ-WVR-013). */}
      <button
        type="button"
        disabled={loading !== null}
        onClick={handleDemoStart}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-[18px] bg-[color:var(--btn-bg)] text-[16px] font-bold text-[color:var(--btn-text)] shadow-[var(--shadow-btn)] transition-colors hover:bg-[color:var(--btn-bg-press)] disabled:opacity-60"
      >
        {loading === 'demo' ? '준비 중…' : '임시 세션으로 둘러보기'}
        {loading !== 'demo' ? (
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M4 10h11M10.5 5.5 15 10l-4.5 4.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </button>

      <div className="flex items-center gap-3 pt-1">
        <div className="h-px flex-1 bg-[color:var(--line)]" />
        <span className="text-[12px] font-semibold text-[color:var(--ink-faint)]">또는 계정으로 계속하기</span>
        <div className="h-px flex-1 bg-[color:var(--line)]" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Link
          href="/signup"
          className="flex h-11 items-center justify-center rounded-[14px] border border-[color:var(--line)] bg-[color:var(--card)] text-[13.5px] font-semibold text-[color:var(--ink)] hover:bg-[color:var(--card-soft)]"
        >
          이메일로 회원가입
        </Link>
        <Link
          href="/login"
          className="flex h-11 items-center justify-center rounded-[14px] border border-[color:var(--line)] bg-[color:var(--card)] text-[13.5px] font-semibold text-[color:var(--ink)] hover:bg-[color:var(--card-soft)]"
        >
          이메일로 로그인
        </Link>
      </div>

      <button
        type="button"
        disabled={loading !== null}
        onClick={handleKakaoStart}
        className="flex h-11 w-full items-center justify-center rounded-[14px] bg-[#FEE500] text-[13.5px] font-semibold text-[#191919] transition-[filter] hover:brightness-95 disabled:opacity-60"
      >
        {loading === 'kakao' ? '확인 중' : '카카오로 계속하기'}
      </button>

      {notice ? <InlineNotice title="로그인 준비 상태" description={notice} tone="blue" /> : null}
    </div>
  );
}
