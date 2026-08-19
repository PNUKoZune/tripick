'use client';

import type { ReactNode } from 'react';

import { Button } from './button';
import { ModalShell } from './modal-shell';

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
  if (!open) return null;

  return (
    <ModalShell
      label={title}
      onDismiss={onCancel}
      themed
      panelClassName="w-full max-w-[360px] rounded-[20px] bg-[color:var(--card,#fff)] p-5 shadow-[0_24px_60px_rgba(15,23,42,0.22)]"
    >
      <h2 className="text-[17px] font-bold leading-6 text-[color:var(--ink,#191F28)]">{title}</h2>
      {description ? (
        <p className="mt-2 text-[14px] leading-[21px] text-[color:var(--ink-sub,#4E5968)]">
          {description}
        </p>
      ) : null}
      <div className="mt-5 flex gap-2">
        <Button variant="ghost" size="md" className="flex-1" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button
          variant={danger ? 'danger' : 'primary'}
          size="md"
          className="flex-1"
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </ModalShell>
  );
}
