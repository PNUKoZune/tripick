import { LuStar } from 'react-icons/lu';
import type { FriendDto } from '@tripick/types';

import { FriendAvatar } from './friend-avatar';

type Props = {
  friend: FriendDto;
  trailing?: React.ReactNode;
};

export function FriendRow({ friend, trailing }: Props) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <FriendAvatar friend={friend} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[15px] font-bold text-[color:var(--ink,#191F28)]">
            {friend.nickname}
          </span>
          {friend.pinned ? (
            <LuStar
              className="size-3 shrink-0 fill-current text-[color:var(--accent-deep,#FF8A00)]"
              aria-label="즐겨찾기"
            />
          ) : null}
        </div>
        <div className="mt-0.5 truncate text-[12px] text-[color:var(--ink-faint,#8B95A1)]">
          {friend.statusMessage ?? friend.handle}
        </div>
      </div>
      {trailing}
    </div>
  );
}
