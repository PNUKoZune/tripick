'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

import { useBodyScrollLock } from '@/shared/lib/use-body-scroll-lock';
import { usePrefersReducedMotion } from '@/shared/lib/use-prefers-reduced-motion';
import { useDismissOnEscape } from '@/shared/lib/use-dismiss-on-escape';
import { useOverlayBackDismiss } from '@/shared/lib/use-overlay-back-dismiss';
import { useFocusTrap } from '@/shared/lib/use-focus-trap';

type Phase = 'closed' | 'opening' | 'open' | 'closing';

type Props = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** 스크린리더가 읽을 시트 이름 */
  label: string;
  /** 시트 안쪽 상단에 그릴 컨텐츠 (지도 등). content 와 같은 카드 안에서 함께 슬라이드 업. */
  topSlot?: ReactNode;
  /**
   * 켜면 포털 루트에 `.wvr-scope` 를 붙이고 시트 크롬(패널·핸들·닫기)을 토큰 색으로 그린다.
   * 포털은 body 로 빠져 AppFrame 의 스코프를 못 받으므로, 다크까지 따라가려면 시트가 직접 스코프를 연다.
   * 기본값 false — 콘텐츠가 아직 토큰화 안 된 시트는 끄고 기존 라이트 고정을 유지한다.
   */
  themed?: boolean;
};

const DURATION_MS = 320;
// 모바일 시트가 올라오는 시간은 조금 더 길게 둬서 급하게 튀어오르는 느낌을 줄인다.
const SHEET_OPEN_MS = 440;
// 시작이 급격하지 않고 부드럽게 감속하는 커브 (Vaul 계열)
const EASE_OUT = 'cubic-bezier(0.32, 0.72, 0, 1)';
const EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)';

export function BottomSheet({ open, onClose, children, label, topSlot, themed = false }: Props) {
  const [phase, setPhase] = useState<Phase>('closed');
  const [isDesktop, setIsDesktop] = useState(false);
  // 아래 transition 은 인라인 style 이라 `@media (prefers-reduced-motion)` 을 못 탄다.
  // 0ms 로 접어 슬라이드·페이드를 없애되, phase 기계와 언마운트 타이밍은 그대로 둔다.
  const reducedMotion = usePrefersReducedMotion();
  const closeTimer = useRef<number | null>(null);
  const openRafs = useRef<number[]>([]);
  // 시트 패널은 phase 가 closed 를 벗어나야 마운트되므로, 트랩도 그때 켜야 ref 를 잡는다
  const panelRef = useFocusTrap<HTMLDivElement>(phase !== 'closed');

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const clearOpenRafs = () => {
      openRafs.current.forEach((id) => cancelAnimationFrame(id));
      openRafs.current = [];
    };
    const clearCloseTimer = () => {
      if (closeTimer.current !== null) {
        window.clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
    };

    if (open) {
      clearCloseTimer();
      // 첫 페인트는 'opening'(translate-y-full)로 마운트한 뒤, 두 번째 rAF에서 'open'으로 전환해야 transition 이 보장된다.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- rAF 트랜지션 보장을 위한 애니메이션 phase 전환
      setPhase((current) => (current === 'open' ? 'open' : 'opening'));
      openRafs.current.push(
        requestAnimationFrame(() => {
          openRafs.current.push(
            requestAnimationFrame(() => {
              setPhase('open');
            }),
          );
        }),
      );
    } else {
      clearOpenRafs();
      setPhase((current) => (current === 'closed' || current === 'closing' ? current : 'closing'));
      closeTimer.current = window.setTimeout(() => {
        setPhase('closed');
      }, DURATION_MS);
    }

    return () => {
      clearOpenRafs();
      clearCloseTimer();
    };
  }, [open]);

  // 시트 패널은 phase 가 closed 를 벗어나야 존재하므로, 잠금·ESC·트랩도 그때만 켠다
  const mounted = phase !== 'closed';
  useBodyScrollLock(mounted);
  useDismissOnEscape(onClose, mounted);
  // 닫히는 중(open=false)엔 등록하지 않는다 — 이미 닫히는 시트가 뒤로가기를 한 번 더 먹으면 안 된다.
  useOverlayBackDismiss(onClose, open);

  if (phase === 'closed') return null;

  const isVisible = phase === 'open';
  const easing = phase === 'closing' ? EASE_IN : EASE_OUT;
  const backdropMs = reducedMotion ? 0 : DURATION_MS;
  const panelMs = reducedMotion ? 0 : phase === 'closing' ? DURATION_MS : SHEET_OPEN_MS;

  // themed 면 토큰 색으로, 아니면 기존 라이트 고정색으로 크롬을 그린다 (비-themed 시트는 바이트 동일).
  const panelBg = themed ? 'bg-[color:var(--card,#fff)]' : 'bg-white';
  const topSlotBg = themed ? 'bg-[color:var(--card,#fff)]' : 'bg-white';
  const grabber = themed ? 'bg-[color:var(--line,#E5E8EB)]' : 'bg-[#E5E8EB]';
  const closeBtn = themed
    ? 'bg-[color:var(--card,#fff)]/90 text-[color:var(--ink-sub,#4E5968)] hover:bg-[color:var(--card,#fff)] hover:text-[color:var(--ink,#191F28)]'
    : 'bg-white/90 text-[#4E5968] hover:bg-white hover:text-[#191F28]';

  return createPortal(
    <div
      className={`fixed inset-0 z-40 ${themed ? 'wvr-scope wvr-overlay' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      {/* 마우스 전용 닫기 영역 — 키보드는 ESC·시트 안 닫기 버튼으로 닫는다 */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-black/45"
        style={{
          opacity: isVisible ? 1 : 0,
          transition: `opacity ${backdropMs}ms ${easing}`,
        }}
      />
      <div
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
        className="absolute inset-0 flex justify-center p-0 lg:items-center lg:p-6"
        style={
          isDesktop
            ? {
                opacity: isVisible ? 1 : 0,
                transform: isVisible ? 'scale(1)' : 'scale(0.96)',
                transition: `opacity ${backdropMs}ms ${easing}, transform ${backdropMs}ms ${easing}`,
                willChange: 'opacity, transform',
                alignItems: 'center',
              }
            : {
                transform: isVisible ? 'translate3d(0, 0, 0)' : 'translate3d(0, 100%, 0)',
                // 올라올 때(opening/open)만 길게, 닫힐 때는 기존 속도 유지
                transition: `transform ${panelMs}ms ${easing}`,
                willChange: 'transform',
                alignItems: 'flex-end',
              }
        }
      >
        <div
          ref={panelRef}
          tabIndex={-1}
          className={`relative flex max-h-full w-full max-w-[480px] flex-col overflow-hidden rounded-t-[20px] ${panelBg} shadow-[0_-16px_40px_rgba(15,23,42,0.18)] outline-none lg:max-w-[560px] lg:rounded-[20px] lg:shadow-[0_24px_60px_rgba(15,23,42,0.22)]`}
        >
          <button
            type="button"
            aria-label="닫기"
            onClick={onClose}
            className={`absolute right-3 top-3 z-10 flex size-9 items-center justify-center rounded-full ${closeBtn} shadow-[0_2px_8px_rgba(15,23,42,0.16)] backdrop-blur transition active:translate-y-px`}
          >
            <CloseIcon />
          </button>
          {topSlot ? <div className={topSlotBg}>{topSlot}</div> : null}
          <div className="flex items-center justify-center pt-2.5 lg:hidden">
            <span className={`h-1 w-10 rounded-full ${grabber}`} />
          </div>
          <div className="max-h-[70vh] min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(24px+var(--safe-bottom))] pt-3 lg:max-h-[78vh] lg:pb-6">
            {children}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
