'use client';

import { LuArrowRight } from 'react-icons/lu';
import type { PlannerItineraryItemDto } from '@tripick/types';

import { estimateEtaMinutes, formatDistance } from '../model/estimate-eta';

type Props = {
  /** 다음 예정 항목 (없으면 렌더 안 함) */
  item: PlannerItineraryItemDto | null;
  /** 현재 위치 ~ 다음 장소 직선 거리(m). 위치 없으면 null */
  distanceM: number | null;
  /** 이동수단 라벨 (meta.transportLabel) */
  transportLabel?: string | undefined;
};

/**
 * Live 화면 상단의 "다음 장소" 안내 바.
 * 다음 예정 일정까지 남은 거리·예상 소요 시간을 보여준다.
 */
export function NextStopBar({ item, distanceM, transportLabel }: Props) {
  if (!item) return null;

  const etaMin = distanceM !== null ? estimateEtaMinutes(distanceM, transportLabel) : null;

  return (
    <div className="mb-3 flex items-center gap-3 rounded-[14px] border border-[color:var(--primary)]/25 bg-[color:var(--primary-tint)] px-4 py-3">
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--btn-bg)] text-[14px] text-[color:var(--btn-text)]"
      >
        <LuArrowRight className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-bold tracking-wide text-[color:var(--primary-deep)]">
          다음 장소
        </div>
        <div className="truncate text-[14px] font-bold text-[color:var(--ink)]">
          {item.scheduledAt} · {item.name}
        </div>
      </div>
      {distanceM !== null && etaMin !== null ? (
        <div className="shrink-0 text-right">
          <div className="text-[15px] font-bold leading-5 text-[color:var(--primary)]">
            약 {etaMin}분
          </div>
          <div className="text-[11px] font-medium text-[color:var(--ink-sub)]">
            {formatDistance(distanceM)}
          </div>
        </div>
      ) : (
        <div className="shrink-0 text-[12px] font-medium text-[color:var(--ink-faint)]">
          위치 확인 중…
        </div>
      )}
    </div>
  );
}
