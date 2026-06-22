'use client';

import type { UserDto } from '@tripick/types';

import { formatJoinedSince } from '@/entities/user';
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
    <div className="relative overflow-hidden rounded-[16px] border border-[#E5E8EB] bg-gradient-to-br from-[#EAF2FF] via-white to-[#F7F8FA] px-4 py-5 lg:px-7 lg:py-7">
      {/* 데코 — 데스크탑 전용 옅은 블롭 */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 hidden size-56 rounded-full bg-[#3182F6]/8 blur-2xl lg:block"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-20 right-10 hidden size-40 rounded-full bg-[#7C3AED]/8 blur-2xl lg:block"
      />

      <div className="relative flex flex-col items-center gap-4 lg:flex-row lg:items-center lg:gap-6">
        <ProfileImageUploader me={me} {...(onError ? { onError } : {})} />

        <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 lg:items-start lg:gap-2">
          <NicknameEditor me={me} {...(onError ? { onError } : {})} />

          <div className="flex flex-col items-center gap-0.5 text-[13px] text-[#6B7684] lg:items-start lg:text-[14px]">
            {me?.email ? <span className="truncate">{me.email}</span> : null}
            {me?.kakaoId ? (
              <span className="truncate text-[#8B95A1]">@{me.kakaoId}</span>
            ) : !me?.email ? (
              <span className="text-[#8B95A1]">카카오 ID 연동 안 됨</span>
            ) : null}
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 lg:justify-start">
            {me?.createdAt ? (
              <MetaChip>
                <CalendarIcon />
                <span>{formatJoinedSince(me.createdAt)}</span>
              </MetaChip>
            ) : null}
            {me?.isDemo ? (
              <span className="inline-flex h-7 items-center rounded-full bg-[#FFF4E6] px-2.5 text-[12px] font-semibold text-[#FF8A00]">
                데모 계정
              </span>
            ) : me?.kakaoId ? (
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
    <span className="inline-flex h-7 items-center gap-1 rounded-full border border-[#E5E8EB] bg-white/80 px-2.5 text-[12px] font-semibold text-[#6B7684] backdrop-blur-sm">
      {children}
    </span>
  );
}

function CalendarIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <path d="M3.5 10h17" />
    </svg>
  );
}
