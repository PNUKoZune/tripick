'use client';

import Link from 'next/link';
import { useState } from 'react';
import { getKakaoStatus, redirectToKakao } from '@/entities/session/api/auth-api';
import { InlineNotice } from '@/shared/ui/app-frame';

/**
 * 랜딩 CTA. 예전 primary 였던 "임시 세션으로 둘러보기"는 없앴다 — 그 버튼은 인증 없이
 * **모든 방문자가 공유하는 계정 하나**로 로그인시켜, 서로의 여행·사진·위치가 그대로 보였다.
 * 이제 실제 계정을 만드는 경로(이메일 가입 / 카카오)만 남기고 가입을 primary 로 올린다.
 */
export function AuthStartActions() {
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleKakaoStart() {
    setLoading(true);
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
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <Link
        href="/signup"
        className="flex h-14 w-full items-center justify-center gap-2 rounded-[18px] bg-[color:var(--btn-bg)] text-[16px] font-bold text-[color:var(--btn-text)] shadow-[var(--shadow-btn)] transition-colors hover:bg-[color:var(--btn-bg-press)]"
      >
        이메일로 시작하기
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M4 10h11M10.5 5.5 15 10l-4.5 4.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </Link>

      <div className="flex items-center gap-3 pt-1">
        <div className="h-px flex-1 bg-[color:var(--line)]" />
        <span className="text-[12px] font-semibold text-[color:var(--ink-faint)]">또는</span>
        <div className="h-px flex-1 bg-[color:var(--line)]" />
      </div>

      <button
        type="button"
        disabled={loading}
        onClick={handleKakaoStart}
        className="flex h-12 w-full items-center justify-center rounded-[14px] bg-[#FEE500] text-[14px] font-semibold text-[#191919] transition-[filter] hover:brightness-95 disabled:opacity-60"
      >
        {loading ? '확인 중' : '카카오로 계속하기'}
      </button>

      <p className="pt-1 text-center text-[13px] text-[color:var(--ink-sub)]">
        이미 계정이 있나요?{' '}
        <Link href="/login" className="font-semibold text-[color:var(--primary)] hover:underline">
          로그인
        </Link>
      </p>

      {notice ? <InlineNotice title="로그인 준비 상태" description={notice} tone="blue" /> : null}
    </div>
  );
}
