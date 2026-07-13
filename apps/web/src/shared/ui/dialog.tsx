'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';

type Props = {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** confirm 버튼을 위험(빨강) 톤으로 */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * 화면 중앙에 뜨는 확인 다이얼로그. 오버레이 클릭·ESC 로 취소된다.
 * 조건부 렌더만 하면 되므로 어디서든 재사용 가능.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '확인',
  cancelLabel = '취소',
  danger = false,
  onConfirm,
  onCancel,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = original;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-5"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label="닫기"
        onClick={onCancel}
        className="absolute inset-0 bg-black/45"
      />
      <div className="relative w-full max-w-[360px] rounded-[20px] bg-white p-5 shadow-[0_24px_60px_rgba(15,23,42,0.22)]">
        <h2 className="text-[17px] font-bold leading-6 text-[#191F28]">{title}</h2>
        {description ? (
          <p className="mt-2 text-[14px] leading-[21px] text-[#4E5968]">{description}</p>
        ) : null}
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-12 flex-1 rounded-[14px] bg-[color:var(--soft-bg)] text-[15px] font-bold text-[#4E5968] transition active:scale-[0.99]"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`h-12 flex-1 rounded-[14px] text-[15px] font-bold text-white transition active:scale-[0.99] ${
              danger ? 'bg-[#F04452]' : 'bg-[color:var(--blue-600)]'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
