import type { ReactNode } from 'react';

type Props = {
  children: ReactNode;
  className?: string;
  /** sub 카드 (#FAFBFC, radius 16) */
  variant?: 'base' | 'sub';
  padding?: 'sm' | 'md';
};

export function SurfaceCard({ children, className, variant = 'base', padding = 'md' }: Props) {
  const base =
    variant === 'sub'
      ? 'rounded-[16px] border border-[#E5E8EB] bg-[#FAFBFC]'
      : 'rounded-[20px] border border-[#E5E8EB] bg-white';
  const pad = padding === 'sm' ? 'p-4' : 'p-5';
  return <section className={`${base} ${pad} ${className ?? ''}`}>{children}</section>;
}
