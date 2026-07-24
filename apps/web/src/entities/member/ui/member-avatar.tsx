'use client';

import { useState } from 'react';
import type { PlannerMemberDto } from '@tripick/types';

type Props = {
  members: PlannerMemberDto[];
};

export function MemberAvatars({ members }: Props) {
  return (
    <div className="flex -space-x-2">
      {members.map((member) => (
        <MemberAvatarItem key={member.id} member={member} />
      ))}
    </div>
  );
}

function MemberAvatarItem({ member }: { member: PlannerMemberDto }) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(member.profileImageUrl) && !imageFailed;

  return (
    <span
      className="flex size-[26px] items-center justify-center overflow-hidden rounded-full border-2 border-white text-[12px] font-bold text-white"
      style={{ backgroundColor: member.color }}
    >
      {showImage ? (
        // 로드 실패 시(만료 URL·403 등) 색상+이니셜 폴백으로 되돌린다.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={member.profileImageUrl}
          alt=""
          className="size-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
        />
      ) : (
        member.initial
      )}
    </span>
  );
}
