'use client';

import { FiChevronRight } from 'react-icons/fi';
import { LuClock3, LuExternalLink, LuGripVertical, LuPencil, LuTrash2 } from 'react-icons/lu';
import type { PlannerItineraryItemDto } from '@tripick/types';

import { ChangeScheduleButton, Chip } from '@/shared/ui';
import { timeSlotColorVar } from '@/shared/config/design-tokens';

/** 카카오맵 장소 페이지 URL. place ID 가 있으면 상세 페이지, 없으면 이름 검색으로 폴백. */
function kakaoPlaceUrl(item: PlannerItineraryItemDto): string {
  return item.kakaoPlaceId
    ? `https://place.map.kakao.com/${item.kakaoPlaceId}`
    : `https://map.kakao.com/link/search/${encodeURIComponent(item.name)}`;
}

const typeToneMap = {
  attraction: 'primary',
  cafe: 'primary',
  restaurant: 'primary',
  transport: 'neutral',
} as const;

/**
 * @MX:NOTE: "하루의 빛" 타임라인 도트 색 — item.scheduledAt(항목 시각)의 시간대에서
 * 결정되는 순수 매핑(timeSlotColorVar, 백엔드 호출 없음). REQ-WVR-042.
 * 이 카드가 렌더되는 모든 진입점(EditableTimeline · widgets/planner-timeline)이
 * 별도 prop 없이 자동으로 색을 얻도록 카드 내부에서 직접 계산한다.
 */
function dotColorValue(item: PlannerItineraryItemDto): string {
  return `var(${timeSlotColorVar(item.scheduledAt)})`;
}

type Props = {
  item: PlannerItineraryItemDto;
  /** 카드 본문 탭 — 지도 초점 이동 등 */
  onClick?: () => void;
  /** 대안 시트를 여는 "전환" 버튼. 없으면 버튼 미표시 */
  onSwitch?: () => void;
  /** 시간·메모 수정 버튼. 있으면 하단 컨트롤 노출 */
  onEdit?: () => void;
  /** 삭제 버튼. 있으면 하단 컨트롤 노출 */
  onDelete?: () => void;
  /** 드래그 핸들 ref (dnd-kit). 있으면 좌측 그립 노출 */
  dragHandleRef?: (element: HTMLElement | null) => void;
  dragging?: boolean;
  selected?: boolean;
  /** 타임라인 마지막 항목이면 연결선을 그리지 않는다 */
  isLast?: boolean;
};

export function ItineraryItemCard({
  item,
  onClick,
  onSwitch,
  onEdit,
  onDelete,
  dragHandleRef,
  dragging = false,
  selected = false,
  isLast = false,
}: Props) {
  const tone = typeToneMap[item.type] ?? 'neutral';
  const dotColor = dotColorValue(item);
  const cardClass = selected
    ? 'border-[color:var(--primary)] bg-[color:var(--primary-tint)] shadow-[var(--shadow-card)]'
    : 'border-[color:var(--line)] bg-[color:var(--card)] hover:border-[color:var(--primary-tint)] hover:bg-[color:var(--card-soft)]';
  const showControls = Boolean(onEdit || onDelete);
  const placeUrl = kakaoPlaceUrl(item);
  return (
    <div
      className={`flex w-full items-stretch gap-2 text-left transition ${dragging ? 'opacity-60' : ''}`}
    >
      <div className="flex w-[42px] shrink-0 flex-col items-end pt-3 text-[13px] font-semibold leading-[18px] text-[color:var(--ink)]">
        {item.scheduledAt}
      </div>
      <div className="relative flex flex-col items-center pt-4">
        {/* @MX:NOTE: 도트 색 = 항목 시각의 "하루의 빛" 시간대 색(REQ-WVR-042). 연결선은
            같은 색을 이어받아 하루가 진행될수록 아침→낮→오후→저녁으로 색이 바뀌는
            누적 효과를 만든다(REQ-WVR-041 의 컨테이너 4-stop 그라데이션은
            widgets/planner-timeline 의 레일에서 구현). */}
        <span
          className="size-2.5 rounded-full border-2"
          style={{ background: dotColor, borderColor: 'var(--card)', boxShadow: '0 0 0 1px var(--line)' }}
        />
        {!isLast ? (
          <span className="mt-1 h-full w-[3px] rounded-full" style={{ background: dotColor }} />
        ) : null}
      </div>
      <div className={`relative flex flex-1 rounded-[16px] border transition ${cardClass}`}>
        {dragHandleRef ? (
          <button
            type="button"
            ref={dragHandleRef}
            aria-label="드래그해서 순서 변경"
            title="드래그해서 순서 변경"
            style={{ touchAction: 'none' }}
            className="flex w-8 shrink-0 cursor-grab items-center justify-center rounded-l-[15px] border-r border-[color:var(--line)] bg-[color:var(--card-soft)] text-[color:var(--ink-faint)] transition hover:bg-[color:var(--primary-tint)] hover:text-[color:var(--primary)] active:cursor-grabbing"
          >
            <LuGripVertical className="size-4" />
          </button>
        ) : null}
        <div className="relative min-w-0 flex-1 px-4 py-3">
          <div
            role="button"
            tabIndex={0}
            onClick={onClick}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onClick?.();
              }
            }}
            className="block w-full cursor-pointer text-left outline-none"
          >
          <div className="flex items-center justify-between gap-2">
            <Chip tone={tone}>{item.typeLabel}</Chip>
            {onSwitch ? (
              <span className="h-8" />
            ) : (
              <FiChevronRight aria-hidden className="size-4 text-[color:var(--ink-faint)]" />
            )}
          </div>
          <div
            className={`mt-2 text-[16px] font-semibold leading-[24px] text-[color:var(--ink)] ${onSwitch ? 'pr-[70px]' : 'pr-10'}`}
          >
            {item.name}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] leading-[18px] text-[color:var(--ink-sub)]">
            <span>{item.durationLabel}</span>
            {item.openingHours ? (
              <span
                className="inline-flex items-center gap-1 text-[color:var(--ok)]"
                aria-label={`영업시간 ${item.openingHours}`}
              >
                <LuClock3 aria-hidden className="size-3.5" />
                {item.openingHours}
              </span>
            ) : null}
          </div>
          {item.memo ? (
            <div className="mt-1.5 line-clamp-2 rounded-[8px] bg-[color:var(--bg)] px-2 py-1 text-[12px] leading-[17px] text-[color:var(--ink-sub)]">
              {item.memo}
            </div>
          ) : null}
        </div>
        {onSwitch ? (
          <div className="absolute right-3 top-3">
            <ChangeScheduleButton onClick={onSwitch} label="변경" />
          </div>
        ) : null}
        <div className="mt-2 flex items-center justify-between gap-1 border-t border-[color:var(--card-soft)] pt-2">
          <a
            href={placeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-7 items-center gap-1 rounded-[8px] px-2 text-[12px] font-semibold text-[color:var(--ink-sub)] hover:bg-[color:var(--card-soft)]"
          >
            <LuExternalLink className="size-3.5" />
            카카오맵
          </a>
          {showControls ? (
            <div className="flex items-center gap-1">
              {onEdit ? (
                <button
                  type="button"
                  onClick={onEdit}
                  className="flex h-7 items-center gap-1 rounded-[8px] px-2 text-[12px] font-semibold text-[color:var(--ink-sub)] hover:bg-[color:var(--card-soft)]"
                >
                  <LuPencil className="size-3.5" />
                  수정
                </button>
              ) : null}
              {onDelete ? (
                <button
                  type="button"
                  onClick={onDelete}
                  className="flex h-7 items-center gap-1 rounded-[8px] px-2 text-[12px] font-semibold text-[color:var(--danger)] hover:bg-[color:var(--danger-tint)]"
                >
                  <LuTrash2 className="size-3.5" />
                  삭제
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        </div>
      </div>
    </div>
  );
}
