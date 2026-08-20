import type { ReactNode } from 'react';

/**
 * 로딩 자리표시 블록. 색은 `--line` 토큰이라 스코프 안에서 다크까지 따라가고,
 * 훑고 지나가는 빛(`app-shimmer`)은 `prefers-reduced-motion: no-preference` 안에만
 * 정의돼 있어 reduce 에서는 정지한 회색 블록으로 남는다.
 *
 * 크기는 호출부가 정한다 — 자리표시는 "실제 콘텐츠가 들어올 자리"와 같은 높이여야
 * 데이터가 도착할 때 레이아웃이 튀지 않는다.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`app-shimmer block rounded-full bg-[color:var(--line,#EEF1F5)] ${className}`}
    />
  );
}

/**
 * 목록 자리표시 공통 껍데기. 스크린리더에는 "불러오는 중"만 알리고(`role="status"`),
 * 시각적 블록들은 `aria-hidden` 인 {@link Skeleton} 이라 읽히지 않는다.
 */
export function SkeletonList({
  label = '불러오는 중',
  className = '',
  children,
}: {
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role="status" aria-live="polite" aria-busy className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
