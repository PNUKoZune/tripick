'use client';

import { LuCalendar } from 'react-icons/lu';
import type { UserDto } from '@tripick/types';

import { formatJoinedSince } from '@/entities/user';
import { HandleEditor } from '@/features/edit-handle';
import { NicknameEditor } from '@/features/edit-nickname';
import { ProfileImageUploader } from '@/features/manage-profile-image';

type Props = {
  me: UserDto | null | undefined;
  onError?: (error: Error | null) => void;
};

/**
 * 설정 페이지의 프로필 hero 카드.
 * 그라데이션 배경 + 아바타(업로드) + 닉네임 편집 + 이메일/카카오ID + 가입일/계정 출처 칩.
 */
export function SettingsProfileHero({ me, onError }: Props) {
  return (
    <div
      className="relative overflow-hidden rounded-[16px] border border-[color:var(--line)] px-4 py-5 lg:px-7 lg:py-7"
      style={{
        background:
          'linear-gradient(135deg, var(--primary-tint) 0%, var(--card) 55%, var(--bg) 100%)',
      }}
    >
      {/* 데코 — 데스크탑 전용 옅은 블롭. 파랑·노을 두 축으로 랜딩 hero 와 같은 색 언어. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 hidden size-56 rounded-full opacity-10 blur-2xl lg:block"
        style={{ background: 'var(--primary)' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-20 right-10 hidden size-40 rounded-full opacity-10 blur-2xl lg:block"
        style={{ background: 'var(--accent)' }}
      />

      <div className="relative flex flex-col items-center gap-4 lg:flex-row lg:items-center lg:gap-6">
        <ProfileImageUploader me={me} {...(onError ? { onError } : {})} />

        <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 lg:items-start lg:gap-2">
          <NicknameEditor me={me} {...(onError ? { onError } : {})} />

          <div className="flex flex-col items-center gap-0.5 text-[13px] text-[color:var(--ink-sub)] lg:items-start lg:text-[14px]">
            <HandleEditor me={me} {...(onError ? { onError } : {})} />
            {me?.email ? <span className="truncate">{me.email}</span> : null}
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 lg:justify-start">
            {me?.createdAt ? (
              <MetaChip>
                <LuCalendar className="size-3" aria-hidden />
                <span>{formatJoinedSince(me.createdAt)}</span>
              </MetaChip>
            ) : null}
            {me?.isDemo ? (
              <span className="inline-flex h-7 items-center rounded-full bg-[color:var(--accent-tint)] px-2.5 text-[12px] font-semibold text-[color:var(--accent-deep)]">
                데모 계정
              </span>
            ) : me?.kakaoId ? (
              // 카카오 브랜드 색은 라이트·다크와 무관하게 고정(로고 색 규정) — 토큰화 대상 아님.
              <span className="inline-flex h-7 items-center gap-1 rounded-full bg-[#FEE500]/40 px-2.5 text-[12px] font-semibold text-[#3C1E1E]">
                카카오 연동
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function MetaChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-7 items-center gap-1 rounded-full border border-[color:var(--line)] bg-[color:var(--card)]/80 px-2.5 text-[12px] font-semibold text-[color:var(--ink-sub)] backdrop-blur-sm">
      {children}
    </span>
  );
}
