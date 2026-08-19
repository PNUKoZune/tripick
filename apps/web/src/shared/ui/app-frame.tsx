'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { IconType } from 'react-icons';
import {
  IoHome,
  IoHomeOutline,
  IoNotifications,
  IoNotificationsOutline,
  IoOptions,
  IoOptionsOutline,
  IoPeople,
  IoPeopleOutline,
  IoSettings,
  IoSettingsOutline,
} from 'react-icons/io5';

import { useInboxUnreadCount } from './inbox-badge-context';

const NAV_ITEMS = [
  { href: '/', label: '홈', icon: 'home' },
  { href: '/preferences', label: '취향', icon: 'preference' },
  { href: '/friends', label: '친구', icon: 'members' },
  { href: '/inbox', label: '알림', icon: 'inbox' },
  { href: '/settings', label: '설정', icon: 'settings' },
] as const;

type NavIconName = (typeof NAV_ITEMS)[number]['icon'];

// 직전 하단 탭 인덱스 — 모듈 스코프라 클라이언트 내비게이션(페이지 리마운트)을 넘어 살아남는다
let lastNavIndex: number | null = null;

function navIndexOf(pathname: string): number | null {
  const index = NAV_ITEMS.findIndex((item) => isNavItemActive(pathname, item.href));
  return index === -1 ? null : index;
}

/**
 * 하단 탭 이동 방향에 맞는 페이지 등장 클래스. 오른쪽 탭으로 갔으면 오른쪽에서,
 * 왼쪽 탭으로 갔으면 왼쪽에서 슬라이드해 들어온다(모바일 한정 — 데스크탑은 페이드).
 * 탭 밖 화면(로그인·공유 등)이나 첫 진입, 같은 탭 클러스터 내 이동은 페이드.
 * 방향은 마운트 시 useState 초기화로 한 번만 확정하고(리렌더에 고정), 직전 탭 기록은
 * 커밋 후 effect 에서 갱신한다 — StrictMode 의 이중 호출에도 안전한 분리다.
 */
export function useNavSlideClass(): string {
  const pathname = usePathname();
  const [cls] = useState(() => {
    const index = navIndexOf(pathname);
    if (index === null || lastNavIndex === null || index === lastNavIndex) return 'app-page-in';
    return index > lastNavIndex ? 'app-slide-in-right' : 'app-slide-in-left';
  });
  useEffect(() => {
    lastNavIndex = navIndexOf(pathname);
  }, [pathname]);
  return cls;
}

/**
 * 탭 아이콘은 Ionicons 선/채움 페어를 쓴다 — 비활성은 아웃라인, 활성은 채움.
 * 모바일 하단 탭·데스크탑 사이드 네비가 같은 페어를 공유해 메타포가 어긋나지 않는다.
 */
const NAV_ICONS: Record<NavIconName, { outline: IconType; filled: IconType }> = {
  home: { outline: IoHomeOutline, filled: IoHome },
  preference: { outline: IoOptionsOutline, filled: IoOptions },
  members: { outline: IoPeopleOutline, filled: IoPeople },
  inbox: { outline: IoNotificationsOutline, filled: IoNotifications },
  settings: { outline: IoSettingsOutline, filled: IoSettings },
};

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
  const pageInClass = useNavSlideClass();

  if (!showNav) {
    // themed 면 .wvr-scope 가 배경(--bg)까지 정하므로 bg 유틸리티를 겹쳐 주지 않는다.
    return (
      <main
        className={`${pageInClass} overflow-x-clip ${themed ? 'wvr-scope min-h-dvh' : 'min-h-dvh bg-[color:var(--app-surface)]'}`}
      >
        {children}
      </main>
    );
  }

  return (
    <div
      className={`min-h-dvh overflow-x-clip bg-[color:var(--app-bg)] ${themed ? 'wvr-scope' : ''}`}
    >
      <div className="mx-auto w-full max-w-[430px] bg-[color:var(--app-surface)] pb-[88px] lg:grid lg:max-w-[1440px] lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-6 lg:bg-transparent lg:px-6 lg:pb-0">
        <AppDesktopNavigation />
        {/* 본문만 등장 모션 — 탭바·사이드 네비는 애니메이션 없이 그려 셸이 고정된 것처럼 보이게 한다 */}
        <div
          className={`${pageInClass} min-h-dvh lg:border-x lg:border-[color:var(--line-strong)] lg:bg-[color:var(--app-surface)]`}
        >
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
      className={`fixed bottom-0 left-1/2 z-30 w-full max-w-[430px] -translate-x-1/2 rounded-t-[20px] border-t border-[color:var(--line-strong)] bg-[color:var(--app-surface)]/85 px-2 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 shadow-[0_-10px_28px_-14px_rgba(25,31,40,0.16)] backdrop-blur-xl ${className}`}
    >
      <div className="grid h-[62px] grid-cols-5 items-stretch">
        {NAV_ITEMS.map((item) => {
          const active = isNavItemActive(pathname, item.href);
          const badge = item.icon === 'inbox' ? inboxUnread : 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`group flex h-full flex-col items-center justify-center gap-[3px] text-[11px] font-bold leading-4 transition-colors active:scale-[0.96] ${
                active
                  ? 'text-[color:var(--blue-600)]'
                  : 'text-[color:var(--text-tertiary)] hover:text-[color:var(--text-secondary)]'
              }`}
            >
              {/* 아이콘을 감싸는 캡슐: 활성이면 blue-50 pill 이 펼쳐지고 아이콘이 살짝 커진다.
                  탭 이동은 페이지 리마운트라 transition 이 못 돌기 때문에, 활성 탭의
                  등장 모션은 마운트 시 재생되는 keyframe(app-nav-pill-in·app-nav-pop)으로 건다 */}
              <span className="relative flex h-8 w-[52px] items-center justify-center">
                <span
                  aria-hidden="true"
                  className={`absolute inset-0 rounded-full bg-[color:var(--blue-50)] transition-all duration-200 ease-out ${
                    active ? 'app-nav-pill-in scale-100 opacity-100' : 'scale-75 opacity-0'
                  }`}
                />
                <span
                  className={`relative transition-transform duration-200 ease-out ${
                    active ? 'app-nav-pop scale-105' : 'group-hover:scale-105'
                  }`}
                >
                  <NavIcon name={item.icon} active={active} />
                  <NavBadge count={badge} />
                </span>
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
      // 10px 은 폰트 메트릭(ascent 10 / descent 2)이 마침 대칭이라 leading-none 만으로 정중앙이다.
      // num-badge 를 붙이면 padding 만큼 0.5px 내려간다 — 실측값이라 사이즈 바꾸면 다시 재야 한다.
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
        <Link
          href="/"
          className="text-[24px] font-extrabold leading-8 text-[color:var(--blue-600)]"
        >
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
                className={`flex h-12 items-center gap-3 rounded-[16px] px-4 text-[15px] font-bold transition-colors ${
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
                    className="num-badge ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-[color:var(--danger,#F04452)] px-1.5 text-[11px] font-bold text-white"
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
  const Icon = active ? NAV_ICONS[name].filled : NAV_ICONS[name].outline;
  return <Icon aria-hidden="true" className="size-[23px]" />;
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
    // 비스코프 화면에서도 쓰이므로 폴백을 남긴다(라이트 값은 기존 rose/emerald 와 동급).
    red: 'bg-[color:var(--danger-tint,#fff1f2)] text-[color:var(--danger,#be123c)]',
    green: 'bg-[color:var(--ok,#047857)]/12 text-[color:var(--ok,#047857)]',
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
