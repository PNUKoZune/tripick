'use client';

import { FiInfo } from 'react-icons/fi';

type Align = 'center' | 'left' | 'right';
type Side = 'top' | 'bottom';

type Props = {
  /** 툴팁 본문 (aria-label 로도 사용) */
  message: string;
  /** 툴팁 너비 Tailwind 클래스. 기본 w-[200px] */
  widthClass?: string;
  /** 아이콘 기준 툴팁 정렬. 화면 가장자리면 right/left 로 넘침 방지. 기본 center */
  align?: Align;
  /**
   * 툴팁이 뜨는 방향. 기본 top.
   * 스크롤 컨테이너(overflow-hidden/auto) 최상단 근처에서는 위로 뜨면 잘리므로 bottom 을 쓴다.
   */
  side?: Side;
  className?: string;
};

const ALIGN_CLASS: Record<Align, string> = {
  center: 'left-1/2 -translate-x-1/2',
  left: 'left-0',
  right: 'right-0',
};

const SIDE_CLASS: Record<Side, string> = {
  top: 'bottom-[calc(100%+6px)]',
  bottom: 'top-[calc(100%+6px)]',
};

/**
 * info 아이콘 + hover/focus 시 나타나는 말풍선 툴팁.
 * 근사치·주의사항 같은 부가 설명을 붙일 때 사용한다.
 */
export function InfoTooltip({
  message,
  widthClass = 'w-[200px]',
  align = 'center',
  side = 'top',
  className,
}: Props) {
  return (
    <span className={`group/info relative inline-flex ${className ?? ''}`}>
      <button
        type="button"
        aria-label={message}
        className="flex items-center justify-center text-[#8B95A1]"
      >
        <FiInfo aria-hidden className="h-[15px] w-[15px]" />
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-10 ${SIDE_CLASS[side]} ${ALIGN_CLASS[align]} ${widthClass} rounded-[8px] bg-[#191F28] px-2.5 py-1.5 text-[11px] font-medium leading-[16px] text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover/info:opacity-100 group-focus-within/info:opacity-100`}
      >
        {message}
      </span>
    </span>
  );
}
