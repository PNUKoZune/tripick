'use client';

import { FiInfo } from 'react-icons/fi';

import type { PlannerTripDto, PlannerTripMetaDto } from '@tripick/types';

import { MemberAvatars } from '@/entities/member';
import { Chip, SurfaceCard } from '@/shared/ui';

type Props = {
  trip: PlannerTripDto;
};

export function TripInfoPanel({ trip }: Props) {
  const meta = trip.meta;
  return (
    <div className="space-y-3 pb-4">
      <SurfaceCard padding="sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[12px] font-semibold text-[#8B95A1]">여행 개요</div>
            <h3 className="mt-1 text-[18px] font-bold leading-[26px] text-[#191F28]">
              {trip.title}
            </h3>
            <div className="mt-1 text-[13px] leading-[20px] text-[#6B7684]">
              {meta.durationLabel}
            </div>
          </div>
          <MemberAvatars members={trip.members} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <MetaTile label="이동 수단" value={meta.transportLabel} />
          <MetaTile label="멤버" value={`${trip.members.length}명`} />
          <MetaTile label="기상" value={meta.wakeTime} />
          <MetaTile label="취침" value={meta.sleepTime} />
        </div>
      </SurfaceCard>

      <SurfaceCard padding="sm">
        <SectionLabel title="취향 태그" description="여행 동선을 만들 때 반영된 기준입니다." />
        <TagRow label="음식" items={meta.tasteTags.food} />
        <TagRow label="분위기" items={meta.tasteTags.mood} />
        <TagRow label="환경" items={meta.tasteTags.environment} />
      </SurfaceCard>

      <SurfaceCard padding="sm">
        <SectionLabel title="일정 통계" description="이번 여행을 한눈에 볼 수 있는 숫자입니다." />
        <div className="mt-2 grid grid-cols-3 gap-2">
          <StatTile label="총 일정" value={`${meta.stats.totalItems}개`} />
          <StatTile
            label="웨이팅"
            value={`${meta.stats.waitingCount}건`}
            tone={meta.stats.waitingCount > 0 ? 'warning' : 'neutral'}
          />
          <StatTile label="예상 이동" value={`${meta.stats.estimatedTravelKm}km`} />
        </div>
      </SurfaceCard>

      <SurfaceCard padding="sm">
        <SectionLabel title="날씨 정보" description="여행 날짜별 확인 상태입니다." />
        <ul className="mt-2 space-y-2">
          {meta.weather.map((w) => (
            <li
              key={w.day}
              className="flex items-center justify-between rounded-[12px] border border-[#E5E8EB] bg-[#FAFBFC] px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span aria-hidden className="text-[18px]">
                  {w.emoji}
                </span>
                <span className="text-[14px] font-semibold text-[#191F28]">{w.label}</span>
                {!w.forecasted ? (
                  <WeatherHint />
                ) : null}
              </div>
              <span className="text-[13px] font-semibold text-[#6B7684]">{w.tempLabel}</span>
            </li>
          ))}
        </ul>
      </SurfaceCard>
    </div>
  );
}

function WeatherHint() {
  const message = '기상청 단기예보는 여행 3일 전부터 확인할 수 있어요.';
  return (
    <span className="group/hint relative inline-flex">
      <button
        type="button"
        aria-label={message}
        className="flex items-center justify-center text-[#8B95A1]"
      >
        <FiInfo aria-hidden className="h-[15px] w-[15px]" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-10 w-[180px] -translate-x-1/2 rounded-[8px] bg-[#191F28] px-2.5 py-1.5 text-[11px] font-medium leading-[16px] text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover/hint:opacity-100 group-focus-within/hint:opacity-100"
      >
        {message}
      </span>
    </span>
  );
}

function MetaTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[12px] border border-[#E5E8EB] bg-[#FAFBFC] px-3 py-2">
      <div className="text-[11px] font-semibold text-[#8B95A1]">{label}</div>
      <div className="mt-1 text-[14px] font-bold text-[#191F28]">{value}</div>
    </div>
  );
}

function StatTile({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'warning';
}) {
  const valueClass = tone === 'warning' ? 'text-[#FF8A00]' : 'text-[#191F28]';
  return (
    <div className="rounded-[12px] border border-[#E5E8EB] bg-white px-3 py-3 text-center">
      <div className="text-[11px] font-semibold text-[#8B95A1]">{label}</div>
      <div className={`mt-1 text-[16px] font-bold ${valueClass}`}>{value}</div>
    </div>
  );
}

function SectionLabel({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <div className="text-[14px] font-bold text-[#191F28]">{title}</div>
      <div className="mt-0.5 text-[12px] text-[#8B95A1]">{description}</div>
    </div>
  );
}

function TagRow({ label, items }: { label: string; items: PlannerTripMetaDto['tasteTags']['food'] }) {
  return (
    <div className="mt-3">
      <div className="text-[12px] font-semibold text-[#8B95A1]">{label}</div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {items.map((item) => (
          <Chip key={item} tone="primary">
            {item}
          </Chip>
        ))}
      </div>
    </div>
  );
}
