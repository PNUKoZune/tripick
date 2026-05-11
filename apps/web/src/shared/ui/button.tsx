import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'md' | 'lg';

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
};

export function Button({
  children,
  variant = 'primary',
  size = 'lg',
  fullWidth,
  className,
  disabled,
  ...rest
}: Props) {
  const height = size === 'lg' ? 'h-14' : 'h-12';
  const base =
    'inline-flex items-center justify-center rounded-[18px] px-5 text-[16px] font-semibold leading-[24px] transition disabled:cursor-not-allowed';
  const variantClass = (() => {
    if (disabled) {
      return 'bg-[#E5E8EB] text-[#B0B8C1]';
    }
    switch (variant) {
      case 'primary':
        return 'bg-[#3182F6] text-white hover:bg-[#1B64DA]';
      case 'secondary':
        return 'bg-white text-[#191F28] border border-[#D6DBE1] hover:bg-[#F2F4F6]';
      case 'ghost':
        return 'bg-transparent text-[#4E5968] hover:bg-[#F2F4F6]';
    }
  })();
  return (
    <button
      type="button"
      disabled={disabled}
      className={`${base} ${height} ${variantClass} ${fullWidth ? 'w-full' : ''} ${className ?? ''}`}
      {...rest}
    >
      {children}
    </button>
  );
}
