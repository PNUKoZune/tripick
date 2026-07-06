'use client';

import { useEffect, useState } from 'react';
import type { PlannerItineraryItemDto } from '@tripick/types';

import type { GeoPosition } from '@/shared/location';
import { BottomSheet, Button } from '@/shared/ui';

import { useReportWaiting } from '../model/use-report-waiting';

const QUICK_MINUTES = [15, 30, 45, 60];

type Props = {
  open: boolean;
  onClose: () => void;
  tripId: string;
  item: PlannerItineraryItemDto | null;
  position?: GeoPosition | null;
};

export function WaitingReportSheet({ open, onClose, tripId, item, position }: Props) {
  const [minutes, setMinutes] = useState(30);
  const { mutateAsync, isPending, isSuccess, reset } = useReportWaiting(tripId);

  // 시트를 새로 열 때마다 상태 초기화
  useEffect(() => {
    if (open) {
      setMinutes(item?.waitingMinutes ?? 30);
      reset();
    }
  }, [open, item, reset]);

  async function handleSubmit() {
    if (!item) return;
    await mutateAsync({ itemId: item.id, waitingMinutes: minutes, position: position ?? null });
    onClose();
  }

  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="px-5 pb-6 pt-2">
        <h2 className="text-[18px] font-bold leading-[26px] text-[#191F28]">웨이팅 신고</h2>
        <p className="mt-1 text-[13px] leading-5 text-[#6B7684]">
          {item ? `‘${item.name}’ 에서` : '현재 일정에서'} 대기 시간이 길어지면 AI가 일정을 다시
          짜드려요.
        </p>

        <div className="mt-5 text-[13px] font-bold text-[#4E5968]">예상 대기 시간</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {QUICK_MINUTES.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setMinutes(value)}
              className={`h-10 rounded-[12px] border px-4 text-[14px] font-bold transition ${
                minutes === value
                  ? 'border-[#3182F6] bg-[#EAF2FF] text-[#1B64DA]'
                  : 'border-[#E5E8EB] bg-white text-[#4E5968] hover:bg-[#FAFBFC]'
              }`}
            >
              {value}분
            </button>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-3">
          <input
            type="range"
            min={5}
            max={120}
            step={5}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className="flex-1 accent-[#3182F6]"
          />
          <span className="w-[56px] text-right text-[14px] font-bold text-[#191F28]">
            {minutes}분
          </span>
        </div>

        <Button
          variant="primary"
          size="lg"
          fullWidth
          className="mt-6"
          onClick={handleSubmit}
          disabled={!item || isPending}
        >
          {isPending ? '신고 중…' : isSuccess ? '신고 완료' : '재계획 요청'}
        </Button>
      </div>
    </BottomSheet>
  );
}
