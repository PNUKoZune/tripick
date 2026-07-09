'use client';

type Props = {
  onClick?: () => void;
  /** 웨이팅 등 긴급 톤(빨강). 기본은 파랑 */
  urgent?: boolean;
  className?: string;
};

/** 일정 변경(대안 전환) 아이콘 버튼. hover/focus 시 "일정 변경" 툴팁 노출 */
export function ChangeScheduleButton({ onClick, urgent = false, className = '' }: Props) {
  return (
    <span className={`group relative inline-flex ${className}`}>
      <button
        type="button"
        onClick={onClick}
        aria-label="일정 변경"
        className={`flex size-8 items-center justify-center rounded-full text-white transition active:translate-y-px ${
          urgent ? 'bg-[#F04452] hover:bg-[#E0303E]' : 'bg-[#3182F6] hover:bg-[#1B64DA]'
        }`}
      >
        <SwapIcon />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute -top-8 right-0 z-10 whitespace-nowrap rounded-[8px] bg-[#191F28] px-2 py-1 text-[12px] font-semibold text-white opacity-0 shadow-[0_4px_12px_rgba(15,23,42,0.18)] transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        일정 변경
      </span>
    </span>
  );
}

function SwapIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 8h13l-3-3M20 16H7l3 3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
