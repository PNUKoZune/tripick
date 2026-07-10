'use client';

import { FiAlertTriangle, FiChevronRight } from 'react-icons/fi';
import { LuGripVertical, LuPencil, LuTrash2 } from 'react-icons/lu';
import type { PlannerItineraryItemDto } from '@tripick/types';

import { ChangeScheduleButton, Chip } from '@/shared/ui';

const typeToneMap = {
  attraction: 'primary',
  cafe: 'primary',
  restaurant: 'primary',
  transport: 'neutral',
} as const;

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
  const cardClass = selected
    ? 'border-[#3182F6] bg-[#EAF2FF] shadow-[0_8px_24px_rgba(49,130,246,0.12)]'
    : 'border-[#E5E8EB] bg-white hover:border-[#C7DCFF] hover:bg-[#FAFBFC]';
  const showControls = Boolean(onEdit || onDelete);
  return (
    <div
      className={`flex w-full items-stretch gap-2 text-left transition ${dragging ? 'opacity-60' : ''}`}
    >
      <div className="flex w-[42px] shrink-0 flex-col items-end pt-3 text-[13px] font-semibold leading-[18px] text-[#191F28]">
        {item.scheduledAt}
      </div>
      <div className="relative flex flex-col items-center pt-4">
        <span className={`size-2.5 rounded-full ${selected ? 'bg-[#1B64DA]' : 'bg-[#3182F6]'}`} />
        {!isLast ? <span className="mt-1 h-full w-px bg-[#E5E8EB]" /> : null}
      </div>
      <div className={`relative flex flex-1 overflow-hidden rounded-[16px] border transition ${cardClass}`}>
        {dragHandleRef ? (
          <button
            type="button"
            ref={dragHandleRef}
            aria-label="드래그해서 순서 변경"
            title="드래그해서 순서 변경"
            style={{ touchAction: 'none' }}
            className="flex w-8 shrink-0 cursor-grab items-center justify-center border-r border-[#EFF1F4] bg-[#FAFBFC] text-[#B0B8C1] transition hover:bg-[#EAF2FF] hover:text-[#3182F6] active:cursor-grabbing"
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
              <FiChevronRight aria-hidden className="size-4 text-[#8B95A1]" />
            )}
          </div>
          <div className="mt-2 pr-10 text-[16px] font-semibold leading-[24px] text-[#191F28]">
            {item.name}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[13px] leading-[18px] text-[#6B7684]">
            <span>{item.durationLabel}</span>
            {item.hasWaiting ? (
              <span className="flex items-center gap-1 text-[#F04452]">
                <FiAlertTriangle aria-hidden className="size-3.5" />
                <span>웨이팅 {item.waitingMinutes ? `${item.waitingMinutes}분` : '있음'}</span>
              </span>
            ) : null}
          </div>
          {item.memo ? (
            <div className="mt-1.5 line-clamp-2 rounded-[8px] bg-[#F7F8FA] px-2 py-1 text-[12px] leading-[17px] text-[#6B7684]">
              {item.memo}
            </div>
          ) : null}
        </div>
        {onSwitch ? (
          <div className="absolute right-3 top-3">
            <ChangeScheduleButton onClick={onSwitch} urgent={item.hasWaiting} />
          </div>
        ) : null}
        {showControls ? (
          <div className="mt-2 flex items-center justify-end gap-1 border-t border-[#F2F4F6] pt-2">
            {onEdit ? (
              <button
                type="button"
                onClick={onEdit}
                className="flex h-7 items-center gap-1 rounded-[8px] px-2 text-[12px] font-semibold text-[#4E5968] hover:bg-[#F2F4F6]"
              >
                <LuPencil className="size-3.5" />
                수정
              </button>
            ) : null}
            {onDelete ? (
              <button
                type="button"
                onClick={onDelete}
                className="flex h-7 items-center gap-1 rounded-[8px] px-2 text-[12px] font-semibold text-[#F04452] hover:bg-[#FFECEE]"
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
  );
}
