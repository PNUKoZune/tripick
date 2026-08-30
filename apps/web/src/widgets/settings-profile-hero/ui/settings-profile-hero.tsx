'use client';

import { LuCalendar } from 'react-icons/lu';
import type { UserDto } from '@tripick/types';

import { formatJoinedSince } from '@/entities/user';
import { HandleEditor } from '@/features/edit-handle';
import { NicknameEditor } from '@/features/edit-nickname';
import { ProfileImageUploader } from '@/features/manage-profile-image';
import { Skeleton, SkeletonList } from '@/shared/ui';

type Props = {
  me: UserDto | null | undefined;
  /** 첫 조회 중이면 같은 크기의 자리표시로 그린다 (닉네임 placeholder·칩 pop-in 방지) */
  loading?: boolean;
  onError?: (error: Error | null) => void;
};

/**
 * 설정 페이지의 프로필 hero 카드.
 * 아바타(업로드) + 닉네임·아이디 편집 + 이메일 + 가입일/계정 출처 칩.
 * 모바일·데스크탑 모두 가로 배치다 — 모바일에서 세로로 쌓아 중앙 정렬하면
 * 좁은 카드의 좌우가 크게 비고 세로만 길어졌다.
 *
 * 배경은 아래 섹션 카드들과 같은 `--card` 로 통일한다 — 대각 그라데이션은 끝이
 * 페이지 배경(`--bg`)으로 빠져 카드 경계가 사라지고, 흰 카드로 이어지는 나머지
 * 섹션과 언어가 어긋났다. 색은 아바타(primary-tint)와 칩이 내고, 카드 면은
 * 비워 둔다 — 옅은 블롭도 넣어 봤으나 카드 한쪽만 물들어 그라데이션의 축소판이 됐다.
 */
export function SettingsProfileHero({ me, loading = false, onError }: Props) {
  return (
    <div className="overflow-hidden rounded-[16px] border border-[color:var(--line)] bg-[color:var(--card)] px-4 py-5 shadow-[var(--shadow-card)] lg:px-6 lg:py-6">
      {loading ? (
        <HeroSkeleton />
      ) : (
        <div className="flex items-center gap-4 lg:gap-6">
          <ProfileImageUploader me={me} {...(onError ? { onError } : {})} />

          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <NicknameEditor me={me} {...(onError ? { onError } : {})} />
            <HandleEditor me={me} {...(onError ? { onError } : {})} />
            {me?.email ? (
              <span className="mt-0.5 max-w-full truncate text-[13px] text-[color:var(--ink-sub)] lg:text-[14px]">
                {me.email}
              </span>
            ) : null}
            {/* 모바일은 칩을 이름 아래 같은 좌축에 붙인다 — 카드가 좁아 오른쪽에 세울 자리가 없다. */}
            <div className="mt-2 flex flex-wrap gap-1.5 lg:hidden">
              <MetaChips me={me} />
            </div>
          </div>

          {/* 데스크탑은 카드 오른쪽 끝에 세로로 세운다 — 이름 블록만 왼쪽에 몰려
              오른쪽 3분의 2가 비어 보이던 문제. */}
          <div className="hidden shrink-0 flex-col items-end gap-1.5 lg:flex">
            <MetaChips me={me} />
          </div>
        </div>
      )}
    </div>
  );
}

/** 가입일 + 계정 출처. 모바일(이름 아래)·데스크탑(카드 우측) 두 자리에서 같은 내용을 그린다. */
function MetaChips({ me }: { me: UserDto | null | undefined }) {
  return (
    <>
      {me?.createdAt ? (
        <MetaChip>
          <LuCalendar className="size-3" aria-hidden />
          <span>{formatJoinedSince(me.createdAt)}</span>
        </MetaChip>
      ) : null}
      {me?.kakaoId ? (
        // 카카오 브랜드 색은 라이트·다크와 무관하게 고정(로고 색 규정) — 토큰화 대상 아님.
        // 투명도를 주면 다크 배경과 섞여 탁한 올리브가 되므로 불투명 노랑을 쓴다.
        <span className="inline-flex h-7 items-center gap-1 rounded-full bg-[#FEE500] px-2.5 text-[12px] font-semibold text-[#191919]">
          카카오 연동
        </span>
      ) : null}
    </>
  );
}

/** 프로필 hero 자리표시. 아바타·닉네임·아이디/이메일·칩 자리를 실제와 같은 크기로 잡는다. */
function HeroSkeleton() {
  return (
    <SkeletonList label="프로필 불러오는 중" className="flex items-center gap-4 lg:gap-6">
      <Skeleton className="size-20 shrink-0 rounded-full lg:size-24" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Skeleton className="h-[27px] w-32 lg:h-[30px]" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-44 max-w-full" />
        <Skeleton className="mt-1 h-7 w-28 rounded-full lg:hidden" />
      </div>
      <Skeleton className="hidden h-7 w-28 shrink-0 rounded-full lg:block" />
    </SkeletonList>
  );
}

function MetaChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-7 items-center gap-1 rounded-full border border-[color:var(--line)] bg-[color:var(--card-soft)] px-2.5 text-[12px] font-semibold text-[color:var(--ink-sub)]">
      {children}
    </span>
  );
}
