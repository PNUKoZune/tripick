'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useActiveTrip } from '@/entities/trip-plan';

/**
 * 진행 중인 여행이 있을 때만 떠서 `/trip/live` 로 안내하는 플로팅 버튼.
 * 전역(providers)에 마운트되며, 세션이 있고 진행 화면이 아닐 때만 노출된다.
 */
export function ActiveTripFab() {
  const pathname = usePathname();
  const { active } = useActiveTrip();

  if (!active || pathname === '/trip/live') return null;

  return (
    <Link
      href="/trip/live"
      aria-label="진행 중인 여행 보기"
      className="fixed bottom-[calc(88px+var(--safe-bottom))] right-4 z-30 flex h-12 items-center gap-2 rounded-full bg-[#3182F6] pl-3.5 pr-4 text-white shadow-[0_12px_24px_rgba(49,130,246,0.36)] transition active:scale-[0.97] lg:bottom-8 lg:right-8"
    >
      <span className="relative flex size-2.5 items-center justify-center">
        <span className="absolute inline-flex size-full motion-safe:animate-ping rounded-full bg-white/70" />
        <span className="relative inline-flex size-2 rounded-full bg-white" />
      </span>
      <span className="text-[14px] font-bold">여행 중</span>
    </Link>
  );
}
