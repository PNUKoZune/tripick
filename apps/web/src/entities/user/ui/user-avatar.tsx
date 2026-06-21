import type { UserDto } from '@tripick/types';

type Size = 'md' | 'lg' | 'xl';

const sizeClass: Record<Size, string> = {
  md: 'size-14 text-[18px]',
  lg: 'size-20 text-[24px]',
  xl: 'size-20 text-[24px] lg:size-28 lg:text-[32px]',
};

type Props = {
  user: Pick<UserDto, 'nickname' | 'profileImageUrl'> | null | undefined;
  size?: Size;
  className?: string;
};

/** 프로필 이미지가 있으면 표시, 없으면 닉네임 첫 글자 fallback. 순수 표시 컴포넌트. */
export function UserAvatar({ user, size = 'md', className = '' }: Props) {
  return (
    <div
      aria-hidden
      className={`flex items-center justify-center overflow-hidden rounded-full bg-[#EAF2FF] font-bold text-[#1B64DA] ${sizeClass[size]} ${className}`}
    >
      {user?.profileImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.profileImageUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        (user?.nickname?.slice(0, 1) ?? '?')
      )}
    </div>
  );
}
