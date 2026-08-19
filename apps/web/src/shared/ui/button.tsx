import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'kakao';
type Size = 'sm' | 'md' | 'lg';

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
};

const SIZE_CLASS: Record<Size, string> = {
  sm: 'h-10 px-4 text-[14px] leading-[20px]',
  md: 'h-12 px-4 text-[15px] leading-[22px]',
  lg: 'h-14 px-5 text-[16px] leading-[24px]',
};

const VARIANT_CLASS: Record<Variant, string> = {
  primary:
    'bg-[color:var(--btn-bg,#3182F6)] text-[color:var(--btn-text,#fff)] hover:bg-[color:var(--btn-bg-press,#1B64DA)]',
  secondary:
    'border border-[color:var(--line,#D6DBE1)] bg-[color:var(--card,#fff)] text-[color:var(--ink,#191F28)] hover:bg-[color:var(--card-soft,#F2F4F6)]',
  ghost:
    'bg-[color:var(--card-soft,#F2F4F6)] text-[color:var(--ink-sub,#4E5968)] hover:bg-[color:var(--line,#E5E8EB)]',
  danger: 'bg-[color:var(--danger,#F04452)] text-white hover:brightness-95',
  // 카카오 브랜드 색은 고정값 — 다크에서도 버튼 자체가 브랜드 자산이라 토큰화하지 않는다.
  kakao: 'bg-[#FEE500] text-[#191919] hover:brightness-95',
};

/**
 * 앱 전역 버튼 SSOT. 이전엔 이 컴포넌트 · app-frame 의 PrimaryButton/SecondaryButton ·
 * 화면마다 손으로 쓴 raw <button> 세 계통이 각자 높이·라운드·굵기를 갖고 있어서
 * 같은 역할의 버튼이 화면마다 다르게 보였다. 높이는 size, 색은 variant 로만 고른다.
 */
export function Button({
  children,
  variant = 'primary',
  size = 'lg',
  fullWidth,
  className,
  disabled,
  ...rest
}: Props) {
  const base =
    'inline-flex items-center justify-center rounded-[12px] font-bold transition active:scale-[0.99] disabled:cursor-not-allowed';
  const tone = disabled
    ? 'bg-[color:var(--line,#E5E8EB)] text-[color:var(--ink-faint,#B0B8C1)]'
    : VARIANT_CLASS[variant];
  return (
    <button
      type="button"
      disabled={disabled}
      className={`${base} ${SIZE_CLASS[size]} ${tone} ${fullWidth ? 'w-full' : ''} ${className ?? ''}`}
      {...rest}
    >
      {children}
    </button>
  );
}
