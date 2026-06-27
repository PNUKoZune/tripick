'use client';

type Props = {
  open: boolean;
  distanceM: number | null;
  onConfirm: () => void;
  onDismiss: () => void;
  reporting?: boolean;
};

/** 경로 이탈 감지 시 화면 상단에 뜨는 재계획 확인 배너. */
export function DeviationBanner({ open, distanceM, onConfirm, onDismiss, reporting }: Props) {
  if (!open) return null;

  const distanceLabel = distanceM ? `${Math.round(distanceM)}m` : null;

  return (
    <div className="fixed inset-x-0 top-3 z-40 flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-[398px] rounded-[16px] border border-[#FFE0BD] bg-[#FFF4E5] px-4 py-3 shadow-[0_12px_24px_rgba(0,0,0,0.12)]">
        <div className="text-[14px] font-bold leading-5 text-[#FF8A00]">경로를 벗어난 것 같아요</div>
        <p className="mt-0.5 text-[13px] leading-5 text-[#4E5968]">
          다음 장소에서 {distanceLabel ? `약 ${distanceLabel} ` : ''}떨어져 있어요. 지금 위치에
          맞춰 일정을 다시 짜볼까요?
        </p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={onConfirm}
            disabled={reporting}
            className="h-10 flex-1 rounded-[12px] bg-[#3182F6] text-[14px] font-bold text-white hover:bg-[#1B64DA] disabled:opacity-60"
          >
            {reporting ? '요청 중…' : '재계획'}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            disabled={reporting}
            className="h-10 rounded-[12px] border border-[#E5E8EB] bg-white px-4 text-[14px] font-bold text-[#4E5968] hover:bg-[#FAFBFC] disabled:opacity-60"
          >
            무시
          </button>
        </div>
      </div>
    </div>
  );
}
