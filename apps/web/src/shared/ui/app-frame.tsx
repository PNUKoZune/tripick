'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const NAV_ITEMS = [
  { href: '/', label: '홈', icon: 'home' },
  { href: '/preferences', label: '취향', icon: 'preference' },
  { href: '/members', label: '멤버', icon: 'members' },
  { href: '/coordination', label: '조율', icon: 'coordination' },
] as const;

type NavIconName = (typeof NAV_ITEMS)[number]['icon'];

export function AppFrame({ children, showNav = true }: { children: ReactNode; showNav?: boolean }) {
  if (!showNav) {
    return (
      <main className="min-h-screen bg-[color:var(--app-bg)] text-[color:var(--text-primary)]">
        {children}
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[color:var(--app-bg)] text-[color:var(--text-primary)]">
      <div className="mx-auto min-h-screen w-full max-w-[430px] lg:grid lg:max-w-[1180px] lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-6 lg:px-6">
        <AppDesktopNavigation />
        <div className="min-h-screen bg-[color:var(--app-surface)] lg:border-x lg:border-[color:var(--line)]">
          <div className="min-h-screen pb-[88px] lg:pb-12">{children}</div>
        </div>
        <AppBottomNavigation className="lg:hidden" />
      </div>
    </main>
  );
}

export function AppBottomNavigation({ className = '' }: { className?: string }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="하단 탭"
      className={`fixed bottom-0 left-1/2 z-30 w-full max-w-[430px] -translate-x-1/2 border-t border-[color:var(--line)] bg-white/95 px-1.5 pb-[max(10px,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-xl ${className}`}
    >
      <div className="grid h-[66px] grid-cols-4 items-stretch">
        {NAV_ITEMS.map((item) => {
          const active = isNavItemActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`flex h-full flex-col items-center justify-center gap-1 text-[11px] font-black leading-4 transition-colors active:scale-[0.98] ${
                active
                  ? 'text-[color:var(--blue-600)]'
                  : 'text-[color:var(--text-tertiary)] hover:text-[color:var(--text-secondary)]'
              }`}
            >
              <NavIcon name={item.icon} active={active} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function AppDesktopNavigation() {
  const pathname = usePathname();

  return (
    <aside className="hidden py-8 lg:block">
      <div className="sticky top-8">
        <Link href="/" className="text-[24px] font-black leading-8 text-[color:var(--blue-600)]">
          Tripick
        </Link>
        <nav aria-label="데스크탑 내비게이션" className="mt-8 space-y-1">
          {NAV_ITEMS.map((item) => {
            const active = isNavItemActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex h-12 items-center gap-3 rounded-[16px] px-4 text-[15px] font-black transition-colors ${
                  active
                    ? 'bg-white text-[color:var(--blue-600)]'
                    : 'text-[color:var(--text-secondary)] hover:bg-white/70 hover:text-[color:var(--text-primary)]'
                }`}
              >
                <NavIcon name={item.icon} active={active} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}

function isNavItemActive(pathname: string, href: (typeof NAV_ITEMS)[number]['href']) {
  if (href === '/') {
    return pathname === '/' || pathname.startsWith('/trips') || pathname.startsWith('/planner');
  }
  return pathname === href;
}

function NavIcon({ name, active }: { name: NavIconName; active: boolean }) {
  const strokeWidth = active ? 2.35 : 2.1;

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-[23px]"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
    >
      {name === 'home' ? (
        <>
          <path d="M4.5 10.6 12 4.5l7.5 6.1" />
          <path d="M6.8 10.2v8.1c0 .8.6 1.3 1.4 1.3h7.6c.8 0 1.4-.5 1.4-1.3v-8.1" />
          <path d="M10 19.6v-5.1h4v5.1" />
        </>
      ) : null}
      {name === 'preference' ? (
        <>
          <path d="M5 7h7" />
          <path d="M16 7h3" />
          <path d="M5 17h3" />
          <path d="M12 17h7" />
          <circle cx="14" cy="7" r="2.1" />
          <circle cx="10" cy="17" r="2.1" />
        </>
      ) : null}
      {name === 'coordination' ? (
        <>
          <path d="M5 18.5V10" />
          <path d="M12 18.5V5.5" />
          <path d="M19 18.5v-6" />
          <path d="M4 18.5h16" />
        </>
      ) : null}
      {name === 'members' ? (
        <>
          <circle cx="9" cy="8" r="3" />
          <path d="M4.8 19c.7-3.1 2.3-4.7 4.2-4.7s3.5 1.6 4.2 4.7" />
          <path d="M15 10.2a2.5 2.5 0 1 0-.7-4.9" />
          <path d="M15.6 14.6c1.8.4 3 1.8 3.6 4.4" />
        </>
      ) : null}
    </svg>
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
    <header className="sticky top-0 z-20 bg-white/94 px-5 pb-3 pt-5 backdrop-blur-xl lg:static lg:bg-white lg:px-8 lg:pb-4 lg:pt-8">
      <div className="mx-auto flex min-h-11 w-full max-w-[430px] items-center justify-between gap-3 lg:max-w-[880px]">
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
      {muted ? (
        <div className="mx-auto mt-4 h-px w-full max-w-[430px] bg-[color:var(--line)] lg:max-w-[880px]" />
      ) : null}
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
  return (
    <section
      className={`mx-auto w-full max-w-[430px] px-5 py-5 lg:max-w-[880px] lg:px-8 lg:py-6 ${className}`}
    >
      {children}
    </section>
  );
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
