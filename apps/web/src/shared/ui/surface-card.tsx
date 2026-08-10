import type { ReactNode } from 'react';

type Props = {
  children: ReactNode;
  className?: string;
  /** sub 카드 (--card-soft, radius 16) */
  variant?: 'base' | 'sub';
  padding?: 'sm' | 'md';
};

/**
 * 색은 토큰 + hex 폴백으로 준다 — 폴백값이 기존 라이트 색과 같아 `.wvr-scope` 밖 화면은
 * 그대로고, 스코프 안(플래너 등)에서만 다크 값을 상속받는다.
 */
export function SurfaceCard({ children, className, variant = 'base', padding = 'md' }: Props) {
  const base =
    variant === 'sub'
      ? 'rounded-[16px] border border-[color:var(--line,#E5E8EB)] bg-[color:var(--card-soft,#FAFBFC)]'
      : 'rounded-[20px] border border-[color:var(--line,#E5E8EB)] bg-[color:var(--card,#FFFFFF)]';
  const pad = padding === 'sm' ? 'p-4' : 'p-5';
  return <section className={`${base} ${pad} ${className ?? ''}`}>{children}</section>;
}
