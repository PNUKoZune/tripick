'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const NAV_ITEMS = [
  { href: '/', label: '홈' },
  { href: '/preferences', label: '취향' },
  { href: '/coordination', label: '조율' },
  { href: '/members', label: '멤버' },
] as const;

export function AppFrame({ children, showNav = true }: { children: ReactNode; showNav?: boolean }) {
  return (
    <main className="min-h-screen bg-[color:var(--app-bg)] text-[color:var(--text-primary)]">
      <div className="mx-auto min-h-screen w-full max-w-[430px] bg-[color:var(--app-surface)]">
        <div className={showNav ? 'min-h-screen pb-[86px]' : 'min-h-screen'}>{children}</div>
        {showNav ? <BottomNavigation /> : null}
      </div>
    </main>
  );
}

function BottomNavigation() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-1/2 z-30 w-full max-w-[430px] -translate-x-1/2 border-t border-[color:var(--line)] bg-white/95 px-5 pb-4 pt-2 backdrop-blur-xl">
      <div className="grid grid-cols-4 gap-2">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex h-12 items-center justify-center text-[13px] font-bold transition ${
                active
                  ? 'text-[color:var(--blue-600)]'
                  : 'text-[color:var(--text-tertiary)]'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function TopBar({
  title,
  action,
  muted,
}: {
  title: string;
  action?: ReactNode;
  muted?: string;
}) {
  return (
    <header className="sticky top-0 z-20 bg-white/94 px-5 pb-3 pt-5 backdrop-blur-xl">
      <div className="flex min-h-11 items-center justify-between gap-3">
        <div>
          {muted ? (
            <div className="text-[12px] font-bold leading-4 text-[color:var(--text-tertiary)]">
              {muted}
            </div>
          ) : null}
          <h1 className="text-[24px] font-black leading-8">{title}</h1>
        </div>
        {action}
      </div>
      {muted ? <div className="mt-4 h-px bg-[color:var(--line)]" /> : null}
    </header>
  );
}

export function PageSection({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={`px-5 py-5 ${className}`}>{children}</section>;
}

export function PrimaryButton({
  children,
  disabled,
  onClick,
  type = 'button',
  tone = 'blue',
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
  tone?: 'blue' | 'dark' | 'kakao';
}) {
  const toneClass = {
    blue: 'bg-[color:var(--blue-600)] text-white',
    dark: 'bg-[color:var(--text-primary)] text-white',
    kakao: 'bg-[#FEE500] text-[#191919]',
  }[tone];

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`h-14 w-full rounded-[16px] px-5 text-[16px] font-black leading-6 transition active:scale-[0.99] ${
        disabled ? 'bg-[color:var(--pressed-bg)] text-[color:var(--text-tertiary)]' : toneClass
      }`}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  disabled,
  onClick,
  type = 'button',
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className="h-12 w-full rounded-[16px] bg-[color:var(--soft-bg)] px-4 text-[15px] font-black text-[color:var(--text-secondary)] transition active:scale-[0.99] disabled:text-[color:var(--text-tertiary)]"
    >
      {children}
    </button>
  );
}

export function InlineNotice({
  title,
  description,
  tone = 'blue',
}: {
  title: string;
  description: string;
  tone?: 'blue' | 'red' | 'green';
}) {
  const toneClass = {
    blue: 'bg-[color:var(--blue-50)] text-[color:var(--blue-700)]',
    red: 'bg-rose-50 text-rose-700',
    green: 'bg-emerald-50 text-emerald-700',
  }[tone];

  return (
    <div className={`rounded-[16px] px-4 py-3 ${toneClass}`}>
      <div className="text-[14px] font-bold leading-5">{title}</div>
      <div className="mt-1 text-[13px] font-medium leading-5 opacity-90">{description}</div>
    </div>
  );
}

export function SegmentedOption({
  active,
  label,
  sublabel,
  onClick,
}: {
  active: boolean;
  label: string;
  sublabel?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-12 rounded-full px-4 py-3 text-center transition active:scale-[0.99] ${
        active
          ? 'bg-[color:var(--blue-50)] text-[color:var(--blue-700)]'
          : 'bg-[color:var(--soft-bg)] text-[color:var(--text-secondary)]'
      }`}
    >
      <span className="block text-[14px] font-bold leading-5">{label}</span>
      {sublabel ? (
        <span className="mt-1 block text-[12px] font-medium leading-4 text-[color:var(--text-tertiary)]">
          {sublabel}
        </span>
      ) : null}
    </button>
  );
}
