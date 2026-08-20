import type { ReactNode } from 'react';

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'error';

// 색은 토큰 우선 + 하드코딩 hex 폴백. 폴백값이 기존 라이트 색과 동일해
// .wvr-scope 밖(비-themed 화면)에선 기존 그대로, 스코프 안에선 다크까지 따라간다.
const toneClass: Record<Tone, string> = {
  neutral:
    'bg-[color:var(--card,#fff)] text-[color:var(--ink-sub,#6B7684)] border-[color:var(--line,#E5E8EB)]',
  primary:
    'bg-[color:var(--blue-50,#EAF2FF)] text-[color:var(--blue-700,#1B64DA)] border-[color:var(--blue-100,#C7DCFF)]',
  success:
    'bg-[color-mix(in_srgb,var(--ok,#00A86B)_14%,var(--card,#fff))] text-[color:var(--ok,#00A86B)] border-[color-mix(in_srgb,var(--ok,#00A86B)_34%,var(--card,#fff))]',
  warning:
    'bg-[color:var(--accent-tint,#FFF4E5)] text-[color:var(--accent-deep,#FF8A00)] border-[color-mix(in_srgb,var(--accent,#FF9B70)_34%,var(--card,#fff))]',
  error:
    'bg-[color:var(--danger-tint,#FFECEE)] text-[color:var(--danger,#F04452)] border-[color:var(--danger-border,#FECDD3)]',
};

type Props = {
  children: ReactNode;
  tone?: Tone;
  size?: 'sm' | 'md';
};

export function Chip({ children, tone = 'neutral', size = 'sm' }: Props) {
  const padding = size === 'md' ? 'px-3 py-1.5 text-[13px]' : 'px-2.5 py-1 text-[12px]';
  return (
    <span
      className={`inline-flex items-center rounded-full border font-semibold leading-[16px] ${padding} ${toneClass[tone]}`}
    >
      {children}
    </span>
  );
}
