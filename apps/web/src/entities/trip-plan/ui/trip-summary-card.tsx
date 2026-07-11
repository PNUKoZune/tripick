'use client';

import Link from 'next/link';
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
};

export function TripSummaryCard({ trip }: Props) {
  const tone = statusTone[trip.status];
  const inner = (
    <article
      className={`group flex h-full flex-col overflow-hidden rounded-[20px] border border-[#E5E8EB] bg-white shadow-[0_8px_24px_rgba(0,0,0,0.04)] transition ${
        trip.hasDetail
          ? 'hover:border-[#C7DCFF] hover:shadow-[0_12px_32px_rgba(49,130,246,0.12)]'
          : 'opacity-90'
      }`}
    >
      <div className="relative flex h-16 items-center bg-[linear-gradient(135deg,#EAF2FF_0%,#F4F7FB_100%)] px-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-white text-[24px] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
          <span aria-hidden>{trip.coverEmoji}</span>
        </div>
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          <Chip tone={tone}>{trip.statusLabel}</Chip>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-[#8B95A1]">{trip.destination}</div>
          <h3 className="mt-0.5 truncate text-[16px] font-bold leading-[24px] text-[#191F28]">
            {trip.title}
          </h3>
        </div>
        <p className="text-[13px] leading-[20px] text-[#6B7684]">{trip.highlight}</p>
        <div className="mt-auto flex items-center justify-between border-t border-[#E5E8EB] pt-3">
          <div className="text-[12px] text-[#8B95A1]">
            {trip.durationLabel} · 일정 {trip.itemCount}개
          </div>
          <MemberAvatars members={trip.members} />
        </div>
        {!trip.hasDetail ? (
          <div className="rounded-[12px] border border-dashed border-[#E5E8EB] bg-[#FAFBFC] px-3 py-2 text-[12px] text-[#8B95A1]">
            상세 준비 중
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
