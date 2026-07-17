'use client';

import type { PlannerItineraryItemDto } from '@tripick/types';

import { InfoTooltip } from '@/shared/ui';

import { estimateEtaMinutes, formatDistance } from '../model/estimate-eta';

const ETA_DISCLAIMER =
  '실시간 교통 상황은 반영되지 않은 예상 시간이에요. 실제와 다를 수 있으니 정확한 경로는 지도 길찾기로 확인해 주세요.';

type Props = {
  /** 다음 예정 항목 (없으면 렌더 안 함) */
  item: PlannerItineraryItemDto | null;
  /** 현재 위치 ~ 다음 장소 직선 거리(m). 위치 없으면 null */
  distanceM: number | null;
  /** 이동수단 라벨 (meta.transportLabel) */
  transportLabel?: string | undefined;
  /** OTP 실경로 기준 ETA(분). distanceMOtp 와 한 쌍으로 넘어온다. */
  etaMinOtp?: number | null;
  /** OTP 실경로 총 거리(m). etaMinOtp 와 한 쌍. */
  distanceMOtp?: number | null;
};

/**
 * Live 화면 상단의 "다음 장소" 안내 바.
 * 다음 예정 일정까지 남은 거리·예상 소요 시간을 보여준다.
 *
 * 시간·거리는 반드시 같은 출처끼리 짝지어 보여준다. OTP 실경로가 있으면 둘 다 OTP 값,
 * 없으면 둘 다 직선거리 기준(휴리스틱). 섞으면 "경로 22분 / 직선 850m" 처럼
 * 사용자가 850m 를 22분에 걸어간다고 읽게 된다.
 */
export function NextStopBar({
  item,
  distanceM,
  transportLabel,
  etaMinOtp,
  distanceMOtp,
}: Props) {
  if (!item) return null;

  const routed = etaMinOtp != null && distanceMOtp != null;
  const etaMin = routed
    ? etaMinOtp
    : distanceM !== null
      ? estimateEtaMinutes(distanceM, transportLabel)
      : null;
  const shownDistanceM = routed ? distanceMOtp : distanceM;

  return (
    <div className="mb-3 flex items-center gap-3 rounded-[14px] border border-[#D6E4FF] bg-[#EAF2FF] px-4 py-3">
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#3182F6] text-[14px] text-white"
      >
        →
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-bold tracking-wide text-[#1B64DA]">다음 장소</div>
        <div className="truncate text-[14px] font-bold text-[#191F28]">
          {item.scheduledAt} · {item.name}
        </div>
      </div>
      {shownDistanceM !== null && etaMin !== null ? (
        <div className="flex shrink-0 items-center gap-1.5 text-right">
          <div>
            <div className="text-[15px] font-bold leading-5 text-[#3182F6]">약 {etaMin}분</div>
            <div className="text-[11px] font-medium text-[#6B7684]">
              {formatDistance(shownDistanceM)}
            </div>
          </div>
          {/* Live 화면 스크롤 컨테이너 최상단이라 위로 띄우면 잘린다 → 아래로 */}
          <InfoTooltip
            message={ETA_DISCLAIMER}
            align="right"
            side="bottom"
            widthClass="w-[220px]"
          />
        </div>
      ) : (
        <div className="shrink-0 text-[12px] font-medium text-[#8B95A1]">위치 확인 중…</div>
      )}
    </div>
  );
}
