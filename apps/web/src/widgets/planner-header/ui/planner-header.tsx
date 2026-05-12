import Link from 'next/link';
import type { PlannerMemberDto } from '@tripick/types';

import { MemberAvatars } from '@/entities/member';

type Props = {
  title: string;
  members: PlannerMemberDto[];
  backHref?: string;
  backLabel?: string;
};

export function PlannerHeader({
  title,
  members,
  backHref = '/trips',
  backLabel = '내 여행',
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
      <MemberAvatars members={members} />
    </header>
  );
}
