'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { TripSummaryStatus, TripSummaryDto } from '@tripick/types';

import { MemberAvatars } from '@/entities/member';
import { Chip } from '@/shared/ui';

const statusTone: Record<TripSummaryStatus, 'neutral' | 'primary' | 'success' | 'warning'> = {
  draft: 'neutral',
  upcoming: 'primary',
  ongoing: 'warning',
  done: 'success',
};

type Props = {
  trip: TripSummaryDto;
  /**
   * 상세 진입이 불가능한(hasDetail=false) 카드에 노출할 액션 슬롯.
   * 삭제 등 mutation 은 feature 레이어 소관이라 view 에서 주입한다.
   */
  draftAction?: ReactNode;
};

export function TripSummaryCard({ trip, draftAction }: Props) {
  const tone = statusTone[trip.status];
  const inner = (
    <article
      className={`group flex h-full flex-col overflow-hidden rounded-[20px] border border-[color:var(--line,#E5E8EB)] bg-[color:var(--card,#fff)] shadow-[var(--shadow-card,0_8px_24px_rgba(0,0,0,0.04))] transition ${
        trip.hasDetail
          ? 'hover:border-[color:var(--blue-100,#C7DCFF)] hover:shadow-[0_12px_32px_rgba(49,130,246,0.12)]'
          : 'opacity-90'
      }`}
    >
      <div className="relative flex h-16 items-center bg-[linear-gradient(135deg,var(--blue-50,#EAF2FF)_0%,var(--card-soft,#F4F7FB)_100%)] px-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-[color:var(--card,#fff)] text-[24px] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
          <span aria-hidden>{trip.coverEmoji}</span>
        </div>
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          <Chip tone={tone}>{trip.statusLabel}</Chip>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-[color:var(--ink-faint,#8B95A1)]">{trip.destination}</div>
          <h3 className="mt-0.5 truncate text-[16px] font-bold leading-[24px] text-[color:var(--ink,#191F28)]">
            {trip.title}
          </h3>
        </div>
        <p className="text-[13px] leading-[20px] text-[color:var(--ink-sub,#6B7684)]">{trip.highlight}</p>
        <div className="mt-auto flex items-center justify-between border-t border-[color:var(--line,#E5E8EB)] pt-3">
          <div className="text-[12px] text-[color:var(--ink-faint,#8B95A1)]">
            {trip.durationLabel} · 일정 {trip.itemCount}개
          </div>
          <MemberAvatars members={trip.members} />
        </div>
        {!trip.hasDetail ? (
          <div className="flex items-center justify-between gap-2 rounded-[12px] border border-dashed border-[color:var(--line,#E5E8EB)] bg-[color:var(--card-soft,#FAFBFC)] px-3 py-2">
            <span className="text-[12px] text-[color:var(--ink-faint,#8B95A1)]">상세 준비 중</span>
            {draftAction}
          </div>
        ) : null}
      </div>
    </article>
  );

  if (!trip.hasDetail) {
    return (
      <div aria-disabled className="block h-full">
        {inner}
      </div>
    );
  }

  return (
    <Link href={`/planner?tripId=${trip.id}`} className="block h-full">
      {inner}
    </Link>
  );
}
