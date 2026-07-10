import Link from 'next/link';
import { FiChevronLeft, FiPlus } from 'react-icons/fi';
import { LuShare2 } from 'react-icons/lu';
import type { PlannerMemberDto } from '@tripick/types';

import { MemberAvatars } from '@/entities/member';

type Props = {
  title: string;
  members: PlannerMemberDto[];
  backHref?: string;
  backLabel?: string;
  onMembersClick?: () => void;
  onShareClick?: () => void;
};

export function PlannerHeader({
  title,
  members,
  backHref = '/trips',
  backLabel = '내 여행',
  onMembersClick,
  onShareClick,
}: Props) {
  return (
    <header className="flex items-center justify-between gap-2 px-3 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <Link
          href={backHref}
          aria-label={`${backLabel} 으로 돌아가기`}
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-[#191F28] hover:bg-[#F2F4F6]"
        >
          <FiChevronLeft className="size-5" />
        </Link>
        <h1 className="truncate text-[18px] font-bold leading-[26px] text-[#191F28]">{title}</h1>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {onShareClick ? (
          <button
            type="button"
            onClick={onShareClick}
            aria-label="일정 공유"
            className="flex size-9 items-center justify-center rounded-full text-[#4E5968] hover:bg-[#F2F4F6]"
          >
            <LuShare2 className="size-[18px]" />
          </button>
        ) : null}
        {onMembersClick ? (
        <button
          type="button"
          onClick={onMembersClick}
          aria-label="여행 멤버 관리"
          className="-mx-2 flex items-center gap-2 rounded-full px-2 py-1 transition hover:bg-[#F2F4F6]"
        >
            <MemberAvatars members={members} />
            <FiPlus className="size-4 text-[#8B95A1]" aria-hidden />
          </button>
        ) : (
          <MemberAvatars members={members} />
        )}
      </div>
    </header>
  );
}
