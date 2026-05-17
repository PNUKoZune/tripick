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
      <div className="mx-auto min-h-screen w-full max-w-[430px] bg-[color:var(--app-surface)] shadow-[0_0_0_1px_rgba(15,23,42,0.04)]">
        <div className={showNav ? 'min-h-screen pb-[86px]' : 'min-h-screen'}>{children}</div>
        {showNav ? <BottomNavigation /> : null}
      </div>
    </main>
  );
}

function BottomNavigation() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-1/2 z-30 w-full max-w-[430px] -translate-x-1/2 border-t border-[color:var(--line)] bg-white/94 px-5 pb-4 pt-3 backdrop-blur-xl">
      <div className="grid grid-cols-4 gap-2">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex h-11 items-center justify-center rounded-[14px] text-[13px] font-semibold transition ${
                active
                  ? 'bg-[color:var(--blue-50)] text-[color:var(--blue-600)]'
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
    <header className="sticky top-0 z-20 border-b border-[color:var(--line)] bg-white/92 px-5 pb-4 pt-5 backdrop-blur-xl">
      <div className="flex min-h-10 items-center justify-between gap-3">
        <div>
          {muted ? (
            <div className="text-[12px] font-semibold leading-4 text-[color:var(--text-tertiary)]">
              {muted}
            </div>
          ) : null}
          <h1 className="text-[22px] font-bold leading-7 tracking-[-0.01em]">{title}</h1>
        </div>
        {action}
      </div>
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
    blue: 'bg-[color:var(--blue-600)] text-white shadow-[0_12px_24px_rgba(49,130,246,0.22)]',
    dark: 'bg-[color:var(--text-primary)] text-white shadow-[0_12px_24px_rgba(15,23,42,0.18)]',
    kakao: 'bg-[#FEE500] text-[#191919]',
  }[tone];

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`h-14 w-full rounded-[16px] px-5 text-[16px] font-bold leading-6 transition active:scale-[0.99] ${
        disabled ? 'bg-slate-200 text-slate-400 shadow-none' : toneClass
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
      className="h-12 w-full rounded-[14px] border border-[color:var(--line)] bg-white px-4 text-[15px] font-bold text-[color:var(--text-secondary)] transition active:scale-[0.99] disabled:bg-slate-100 disabled:text-slate-400"
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
    blue: 'border-[color:var(--blue-100)] bg-[color:var(--blue-50)] text-[color:var(--blue-700)]',
    red: 'border-rose-100 bg-rose-50 text-rose-700',
    green: 'border-emerald-100 bg-emerald-50 text-emerald-700',
  }[tone];

  return (
    <div className={`rounded-[16px] border px-4 py-3 ${toneClass}`}>
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
      className={`min-h-[56px] rounded-[14px] border px-3 py-3 text-left transition ${
        active
          ? 'border-[color:var(--blue-500)] bg-[color:var(--blue-50)] text-[color:var(--blue-700)]'
          : 'border-[color:var(--line)] bg-white text-[color:var(--text-primary)]'
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
