import type { ReactNode } from 'react';

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'error';

const toneClass: Record<Tone, string> = {
  neutral: 'bg-white text-[#6B7684] border-[#E5E8EB]',
  primary: 'bg-[#EAF2FF] text-[#1B64DA] border-[#C7DCFF]',
  success: 'bg-[#E5F7EE] text-[#00A86B] border-[#BCE9D6]',
  warning: 'bg-[#FFF4E5] text-[#FF8A00] border-[#FFE0BD]',
  error: 'bg-[#FFECEE] text-[#F04452] border-[#FECDD3]',
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
