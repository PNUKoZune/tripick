'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { useInboxUnreadCount } from './inbox-badge-context';

const NAV_ITEMS = [
  { href: '/', label: '홈', icon: 'home' },
  { href: '/preferences', label: '취향', icon: 'preference' },
  { href: '/friends', label: '친구', icon: 'members' },
  { href: '/inbox', label: '알림', icon: 'inbox' },
  { href: '/settings', label: '설정', icon: 'settings' },
] as const;

type NavIconName = (typeof NAV_ITEMS)[number]['icon'];

/**
 * 페이지 셸: 모바일 = 430px 단일 컬럼 + 하단 탭, 데스크탑 = 사이드 네비 + border-x 카드.
 * `showNav={false}` 면 네비·셸 없이 자식만 풀-블리드 (랜딩/콜백용).
 *
 * `themed` 는 "이 화면 본문이 광안리의 하루 팔레트를 쓴다"는 선언이다. 켜면 셸 루트에
 * `.wvr-scope` 가 붙어 배경·탭바·사이드 네비까지 그 팔레트(다크 포함)를 따라간다.
 * 아직 정리되지 않은 화면(로그인·여행 목록 등)에서 켜면 본문만 라이트인 채 셸이 다크가 돼
 * 더 어긋나므로, 본문 토큰화가 끝난 화면에서만 켠다. 기본값은 기존 동작(라이트 고정).
 */
export function AppFrame({
  children,
  showNav = true,
  themed = false,
}: {
  children: ReactNode;
  showNav?: boolean;
  themed?: boolean;
}) {
  if (!showNav) {
    return <main className="min-h-dvh bg-[color:var(--app-surface)]">{children}</main>;
  }

  return (
    <div className={`min-h-dvh bg-[color:var(--app-bg)] ${themed ? 'wvr-scope' : ''}`}>
      <div className="mx-auto w-full max-w-[430px] bg-[color:var(--app-surface)] pb-[88px] lg:grid lg:max-w-[1440px] lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-6 lg:bg-transparent lg:px-6 lg:pb-0">
        <AppDesktopNavigation />
        <div className="min-h-dvh lg:border-x lg:border-[color:var(--line-strong)] lg:bg-[color:var(--app-surface)]">
          {children}
        </div>
      </div>
      <AppBottomNavigation className="lg:hidden" />
    </div>
  );
}

/**
 * 페이지 헤더. 모바일/데스크탑 자동 분기.
 * - mobile: 20px bold 제목 + 부가 설명(선택) + 우측 액션(선택)
 * - desktop: 12px "Tripick · {label}" 라벨(선택) + 22px 제목 + 부가 설명(선택) + 우측 액션
 */
export function PageHeader({
  title,
  description,
  label,
  action,
}: {
  title: string;
  description?: string;
  /** 데스크탑 전용 'Tripick · X' 작은 라벨 */
  label?: string;
  /** 헤더 우측 액션 (배지·버튼 등) */
  action?: ReactNode;
}) {
  return (
    <header className="px-4 pt-5 lg:border-b lg:border-[color:var(--line-strong)] lg:bg-[color:var(--app-surface)] lg:px-0 lg:pt-0">
      <div className="mx-auto flex w-full max-w-[1160px] items-center justify-between gap-3 pb-3 lg:gap-6 lg:px-8 lg:py-4 xl:px-10">
        <div className="min-w-0 flex-1">
          {/* 색은 전역 토큰으로 — 라이트 값은 그대로고, .wvr-scope 안에서 렌더될 때만
              그 스코프의 다크 값을 상속받아 제목이 배경에 묻히지 않는다. */}
          {label ? (
            <div className="hidden text-[12px] font-semibold tracking-wide text-[color:var(--blue-600)] lg:block">
              Tripick · {label}
            </div>
          ) : null}
          <h1 className="text-[20px] font-bold text-[color:var(--text-primary)] lg:mt-0.5 lg:text-[22px] lg:leading-[30px]">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 text-[13px] text-[color:var(--text-secondary)]">{description}</p>
          ) : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
    </header>
  );
}

/** 헤더 아래 본문 컨테이너. 모바일/데스크탑 padding 자동 적용. */
export function PageContainer({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`mx-auto w-full max-w-[1160px] px-4 pb-6 pt-3 lg:px-8 lg:py-6 xl:px-10 ${className}`}
    >
      {children}
    </div>
  );
}

export function AppBottomNavigation({ className = '' }: { className?: string }) {
  const pathname = usePathname();
  const inboxUnread = useInboxUnreadCount();

  return (
    <nav
      aria-label="하단 탭"
      className={`fixed bottom-0 left-1/2 z-30 w-full max-w-[430px] -translate-x-1/2 border-t border-[color:var(--line-strong)] bg-[color:var(--app-surface)]/95 px-1.5 pb-[max(10px,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-xl ${className}`}
    >
      <div className="grid h-[66px] grid-cols-5 items-stretch">
        {NAV_ITEMS.map((item) => {
          const active = isNavItemActive(pathname, item.href);
          const badge = item.icon === 'inbox' ? inboxUnread : 0;
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
              <span className="relative">
                <NavIcon name={item.icon} active={active} />
                <NavBadge count={badge} />
              </span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * nav 아이콘 위에 겹치는 미읽음 배지. 0 이면 렌더하지 않는다.
 * 9 초과는 "9+" 로 축약(하단 탭 폭 제약).
 */
function NavBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={`읽지 않은 알림 ${count}개`}
      className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[color:var(--danger,#F04452)] px-1 text-[10px] font-bold leading-none text-white"
    >
      {count > 9 ? '9+' : count}
    </span>
  );
}

export function AppDesktopNavigation() {
  const pathname = usePathname();
  const inboxUnread = useInboxUnreadCount();

  return (
    <aside className="hidden py-8 lg:block">
      <div className="sticky top-8">
        <Link href="/" className="text-[24px] font-black leading-8 text-[color:var(--blue-600)]">
          Tripick
        </Link>
        <nav aria-label="데스크탑 내비게이션" className="mt-8 space-y-1">
          {NAV_ITEMS.map((item) => {
            const active = isNavItemActive(pathname, item.href);
            const badge = item.icon === 'inbox' ? inboxUnread : 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex h-12 items-center gap-3 rounded-[16px] px-4 text-[15px] font-black transition-colors ${
                  active
                    ? 'bg-[color:var(--app-surface)] text-[color:var(--blue-600)]'
                    : 'text-[color:var(--text-secondary)] hover:bg-[color:var(--app-surface)]/70 hover:text-[color:var(--text-primary)]'
                }`}
              >
                <NavIcon name={item.icon} active={active} />
                <span>{item.label}</span>
                {badge > 0 ? (
                  <span
                    aria-label={`읽지 않은 알림 ${badge}개`}
                    className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-[color:var(--danger,#F04452)] px-1.5 text-[11px] font-bold leading-none text-white"
                  >
                    {badge > 99 ? '99+' : badge}
                  </span>
                ) : null}
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
      {name === 'members' ? (
        <>
          <circle cx="9" cy="8" r="3" />
          <path d="M4.8 19c.7-3.1 2.3-4.7 4.2-4.7s3.5 1.6 4.2 4.7" />
          <path d="M15 10.2a2.5 2.5 0 1 0-.7-4.9" />
          <path d="M15.6 14.6c1.8.4 3 1.8 3.6 4.4" />
        </>
      ) : null}
      {name === 'inbox' ? (
        <>
          <path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-4l-3 3-3-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
          <path d="M8.5 10h7" />
          <path d="M8.5 13h4.5" />
        </>
      ) : null}
      {name === 'settings' ? (
        <>
          <circle cx="12" cy="12" r="2.6" />
          <path d="M12 3.5v2.2" />
          <path d="M12 18.3v2.2" />
          <path d="M3.5 12h2.2" />
          <path d="M18.3 12h2.2" />
          <path d="M5.9 5.9 7.5 7.5" />
          <path d="M16.5 16.5l1.6 1.6" />
          <path d="M5.9 18.1 7.5 16.5" />
          <path d="M16.5 7.5l1.6-1.6" />
        </>
      ) : null}
    </svg>
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
