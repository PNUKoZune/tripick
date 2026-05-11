import type { PlannerMemberDto } from '@tripick/types';

import { MemberAvatars } from '@/entities/member';

type Props = {
  title: string;
  members: PlannerMemberDto[];
};

export function PlannerHeader({ title, members }: Props) {
  return (
    <header className="flex items-center justify-between px-5 py-3">
      <h1 className="text-[18px] font-bold leading-[26px] text-[#191F28]">{title}</h1>
      <MemberAvatars members={members} />
    </header>
  );
}
