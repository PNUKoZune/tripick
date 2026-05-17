import type { PlannerMemberDto } from '@tripick/types';

type Props = {
  members: PlannerMemberDto[];
};

export function MemberAvatars({ members }: Props) {
  return (
    <div className="flex -space-x-2">
      {members.map((member) => (
        <span
          key={member.id}
          className="flex size-[26px] items-center justify-center rounded-full border-2 border-white text-[12px] font-bold text-white"
          style={{ backgroundColor: member.color }}
        >
          {member.initial}
        </span>
      ))}
    </div>
  );
}
