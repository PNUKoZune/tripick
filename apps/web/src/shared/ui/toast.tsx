import type { ReactNode } from 'react';

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'error';

const toneClass: Record<Tone, { container: string; title: string }> = {
  neutral: { container: 'bg-white border-[#E5E8EB]', title: 'text-[#4E5968]' },
  primary: { container: 'bg-[#EAF2FF] border-[#C7DCFF]', title: 'text-[#1B64DA]' },
  success: { container: 'bg-[#E5F7EE] border-[#BCE9D6]', title: 'text-[#00A86B]' },
  warning: { container: 'bg-[#FFF4E5] border-[#FFE0BD]', title: 'text-[#FF8A00]' },
  error: { container: 'bg-[#FFECEE] border-[#FECDD3]', title: 'text-[#F04452]' },
};

type Props = {
  title: ReactNode;
  message?: ReactNode;
  tone?: Tone;
  /** 전달 시 닫기 버튼을 노출한다 */
  onClose?: () => void;
  /** 전달 시 카드 본문 클릭이 가능해진다(닫기 버튼 클릭은 전파 차단) */
  onClick?: () => void;
  /** fixed 컨테이너 위치 override (기본: 화면 하단 중앙) */
  className?: string;
};

/**
 * 화면 하단 중앙에 뜨는 알림 토스트.
 * fixed 컨테이너를 포함하므로 어디서든 조건부 렌더만 하면 된다.
 */
export function Toast({ title, message, tone = 'neutral', onClose, onClick, className }: Props) {
  const palette = toneClass[tone];
  const clickable = Boolean(onClick);
  return (
    <div
      className={`fixed inset-x-0 bottom-[104px] z-40 flex justify-center px-4 lg:bottom-6 ${className ?? ''}`}
      role="status"
      aria-live="polite"
    >
      <div
        {...(clickable
          ? {
              role: 'button' as const,
              tabIndex: 0,
              onClick,
              onKeyDown: (event: React.KeyboardEvent) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onClick?.();
                }
              },
            }
          : {})}
        className={`pointer-events-auto flex w-full max-w-[398px] items-start gap-3 rounded-[16px] border ${palette.container} px-4 py-3 shadow-[0_12px_24px_rgba(0,0,0,0.12)] ${
          clickable ? 'cursor-pointer text-left transition active:scale-[0.99]' : ''
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className={`text-[14px] font-bold leading-5 ${palette.title}`}>{title}</div>
          {message ? (
            <p className="mt-0.5 line-clamp-2 text-[13px] leading-5 text-[#4E5968]">{message}</p>
          ) : null}
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
            aria-label="알림 닫기"
            className="-mr-1 -mt-0.5 shrink-0 rounded-full px-2 py-1 text-[13px] font-semibold text-[#8B95A1] hover:bg-black/5"
          >
            ✕
          </button>
        ) : null}
      </div>
    </div>
  );
}
