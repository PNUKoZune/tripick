import Link from 'next/link';
import type { PlannerMemberDto } from '@tripick/types';

import { MemberAvatars } from '@/entities/member';

type Props = {
  title: string;
  members: PlannerMemberDto[];
  backHref?: string;
  backLabel?: string;
  onMembersClick?: () => void;
};

export function PlannerHeader({
  title,
  members,
  backHref = '/',
  backLabel = '내 여행',
  onMembersClick,
}: Props) {
  return (
    <header className="flex items-center justify-between gap-2 px-3 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <Link
          href={backHref}
          aria-label={`${backLabel} 으로 돌아가기`}
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-[18px] text-[#191F28] hover:bg-[#F2F4F6]"
        >
          ‹
        </Link>
        <h1 className="truncate text-[18px] font-bold leading-[26px] text-[#191F28]">{title}</h1>
      </div>
      {onMembersClick ? (
        <button
          type="button"
          onClick={onMembersClick}
          aria-label="여행 멤버 관리"
          className="-mx-2 flex items-center gap-2 rounded-full px-2 py-1 transition hover:bg-[#F2F4F6]"
        >
          <MemberAvatars members={members} />
          <span className="text-[16px] text-[#8B95A1]" aria-hidden>＋</span>
        </button>
      ) : (
        <MemberAvatars members={members} />
      )}
    </header>
  );
}
