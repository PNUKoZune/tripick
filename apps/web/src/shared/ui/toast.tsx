import { LuX } from 'react-icons/lu';
import type { ReactNode } from 'react';

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'error';

// 색은 토큰 + hex 폴백 — 폴백값이 기존 라이트 색이라 `.wvr-scope` 밖에선 그대로고,
// 스코프 안(플래너·Live 등)에서 렌더될 때만 다크까지 따라간다.
// success·warning 은 wvr 팔레트에 전용 틴트가 없어(--ok / --accent 만 있음) 배경을
// color-mix 로 만든다 — 카드색과 섞으므로 다크에선 자동으로 어두운 틴트가 된다.
const toneClass: Record<Tone, { container: string; title: string }> = {
  neutral: {
    container: 'bg-[color:var(--card,#FFFFFF)] border-[color:var(--line,#E5E8EB)]',
    title: 'text-[color:var(--ink-sub,#4E5968)]',
  },
  primary: {
    container: 'bg-[color:var(--primary-tint,#EAF2FF)] border-[color:var(--primary,#C7DCFF)]/40',
    title: 'text-[color:var(--primary-deep,#1B64DA)]',
  },
  success: {
    container:
      'bg-[color-mix(in_srgb,var(--ok,#00A86B)_14%,var(--card,#fff))] border-[color-mix(in_srgb,var(--ok,#00A86B)_34%,var(--card,#fff))]',
    title: 'text-[color:var(--ok,#00A86B)]',
  },
  warning: {
    container:
      'bg-[color:var(--accent-tint,#FFF4E5)] border-[color-mix(in_srgb,var(--accent,#FF9B70)_34%,var(--card,#fff))]',
    title: 'text-[color:var(--accent-deep,#FF8A00)]',
  },
  error: {
    container: 'bg-[color:var(--danger-tint,#FFECEE)] border-[color:var(--danger-border,#FECDD3)]',
    title: 'text-[color:var(--danger,#F04452)]',
  },
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
  /**
   * 퇴장 중이면 true. 마운트=열림이라 스스로는 사라지는 순간을 알 수 없으므로,
   * 언마운트를 미뤄 주는 호출부(useExitTransition)가 이 프레임 동안 켜 준다.
   */
  closing?: boolean;
};

/**
 * 화면 하단 중앙에 뜨는 알림 토스트.
 * fixed 컨테이너를 포함하므로 어디서든 조건부 렌더만 하면 된다.
 */
export function Toast({
  title,
  message,
  tone = 'neutral',
  onClose,
  onClick,
  className,
  closing = false,
}: Props) {
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
        className={`pointer-events-auto flex w-full max-w-[398px] items-start gap-3 rounded-[16px] border ${
          closing ? 'app-toast-out' : 'app-toast-in'
        } ${palette.container} px-4 py-3 shadow-[0_12px_24px_rgba(0,0,0,0.12)] ${
          clickable ? 'cursor-pointer text-left transition active:scale-[0.99]' : ''
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className={`text-[14px] font-bold leading-5 ${palette.title}`}>{title}</div>
          {message ? (
            <p className="mt-0.5 line-clamp-2 text-[13px] leading-5 text-[color:var(--ink-sub,#4E5968)]">
              {message}
            </p>
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
            className="-mr-1 -mt-0.5 shrink-0 rounded-full p-1.5 text-[color:var(--ink-faint,#8B95A1)] hover:bg-black/5"
          >
            <LuX className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );
}
