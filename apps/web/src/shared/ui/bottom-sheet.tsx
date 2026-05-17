'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

type Phase = 'closed' | 'opening' | 'open' | 'closing';

type Props = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** 시트 안쪽 상단에 그릴 컨텐츠 (지도 등). content 와 같은 카드 안에서 함께 슬라이드 업. */
  topSlot?: ReactNode;
};

const DURATION_MS = 320;
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
const EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)';

export function BottomSheet({ open, onClose, children, topSlot }: Props) {
  const [phase, setPhase] = useState<Phase>('closed');
  const closeTimer = useRef<number | null>(null);
  const openRafs = useRef<number[]>([]);

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

  useEffect(() => {
    if (phase === 'closed') return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = original;
      window.removeEventListener('keydown', onKey);
    };
  }, [phase, onClose]);

  if (phase === 'closed') return null;

  const isVisible = phase === 'open';
  const easing = phase === 'closing' ? EASE_IN : EASE_OUT;

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        aria-label="close"
        onClick={onClose}
        className="absolute inset-0 bg-black/45"
        style={{
          opacity: isVisible ? 1 : 0,
          transition: `opacity ${DURATION_MS}ms ${easing}`,
        }}
      />
      <div
        className="absolute inset-x-0 bottom-0 flex justify-center"
        style={{
          transform: isVisible ? 'translate3d(0, 0, 0)' : 'translate3d(0, 100%, 0)',
          transition: `transform ${DURATION_MS}ms ${easing}`,
          willChange: 'transform',
        }}
      >
        <div className="flex w-full max-w-[480px] flex-col overflow-hidden rounded-t-[24px] bg-white shadow-[0_-16px_40px_rgba(15,23,42,0.18)]">
          {topSlot ? <div className="bg-white">{topSlot}</div> : null}
          <div className="flex items-center justify-center pt-2.5">
            <span className="h-1 w-10 rounded-full bg-[#E5E8EB]" />
          </div>
          <div className="max-h-[70vh] overflow-y-auto px-5 pb-6 pt-3">{children}</div>
        </div>
      </div>
    </div>
  );
}
