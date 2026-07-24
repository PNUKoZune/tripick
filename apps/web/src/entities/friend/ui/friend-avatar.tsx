'use client';

import { useState } from 'react';
import type { FriendDto } from '@tripick/types';

type Size = 'sm' | 'md' | 'lg';

const SIZE_CLASS: Record<Size, string> = {
  sm: 'size-8 text-[12px]',
  md: 'size-11 text-[14px]',
  lg: 'size-14 text-[18px]',
};

type Props = {
  friend: Pick<FriendDto, 'color' | 'initial' | 'emoji' | 'profileImageUrl'>;
  size?: Size;
};

export function FriendAvatar({ friend, size = 'md' }: Props) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(friend.profileImageUrl) && !imageFailed;

  return (
    <span
      aria-hidden
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-white ${SIZE_CLASS[size]}`}
      style={{ background: friend.color }}
    >
      {showImage ? (
        // 이미지 로드 실패 시(만료 URL·403 등) 색상+이니셜 폴백으로 되돌린다.
        <img
          src={friend.profileImageUrl}
          alt=""
          className="size-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
        />
      ) : friend.emoji ? (
        <span className="text-[20px] leading-none">{friend.emoji}</span>
      ) : (
        friend.initial
      )}
    </span>
  );
}
