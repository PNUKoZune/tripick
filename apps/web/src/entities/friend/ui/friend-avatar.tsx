import type { FriendDto } from '@tripick/types';

type Size = 'sm' | 'md' | 'lg';

const SIZE_CLASS: Record<Size, string> = {
  sm: 'size-8 text-[12px]',
  md: 'size-11 text-[14px]',
  lg: 'size-14 text-[18px]',
};

type Props = {
  friend: Pick<FriendDto, 'color' | 'initial' | 'emoji'>;
  size?: Size;
};

export function FriendAvatar({ friend, size = 'md' }: Props) {
  return (
    <span
      aria-hidden
      className={`relative flex shrink-0 items-center justify-center rounded-full font-bold text-white ${SIZE_CLASS[size]}`}
      style={{ background: friend.color }}
    >
      {friend.emoji ? (
        <span className="text-[20px] leading-none">{friend.emoji}</span>
      ) : (
        friend.initial
      )}
    </span>
  );
}
