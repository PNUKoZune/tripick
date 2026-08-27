'use client';

import { createPortal } from 'react-dom';
import { LuX } from 'react-icons/lu';

import { useBodyScrollLock } from '@/shared/lib/use-body-scroll-lock';
import { useDismissOnEscape } from '@/shared/lib/use-dismiss-on-escape';
import { useOverlayBackDismiss } from '@/shared/lib/use-overlay-back-dismiss';
import { useFocusTrap } from '@/shared/lib/use-focus-trap';

type Props = {
  src: string;
  /** 스크린리더 라벨 + 이미지 alt */
  label?: string;
  onClose: () => void;
};

/**
 * 이미지 확대 보기(라이트박스). 백드롭·ESC·닫기 버튼으로 닫는다.
 * 이미지는 뷰포트 안에 비율 유지로 맞춘다(object-contain). 열림 여부는 호출부의 조건부 렌더로 정한다.
 */
export function ImageLightbox({ src, label = '이미지 확대 보기', onClose }: Props) {
  const panelRef = useFocusTrap<HTMLDivElement>();
  useBodyScrollLock();
  useDismissOnEscape(onClose);
  useOverlayBackDismiss(onClose, true);

  // 조상의 transform·filter 에 fixed 오버레이가 갇히지 않게 body 로 포털.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      {/* 마우스 전용 닫기 영역 — 키보드·스크린리더에는 ESC 와 닫기 버튼이 있어 탭 순서에서 뺀다 */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-black/80"
      />
      <div ref={panelRef} tabIndex={-1} className="relative outline-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={label}
          className="max-h-[90vh] max-w-[92vw] rounded-[12px] object-contain shadow-2xl"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className="absolute -right-3 -top-3 flex size-9 items-center justify-center rounded-full bg-white text-[color:var(--ink,#191F28)] shadow-md transition hover:bg-[color:var(--card-soft,#F2F4F6)]"
        >
          <LuX className="size-5" aria-hidden />
        </button>
      </div>
    </div>,
    document.body,
  );
}
