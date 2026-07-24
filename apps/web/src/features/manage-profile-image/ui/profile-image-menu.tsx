'use client';

import { ModalShell } from '@/shared/ui';

type Props = {
  hasCustomImage: boolean;
  pending: boolean;
  onClose: () => void;
  onPickFile: () => void;
  onRevert: () => void;
};

/** 프로필 이미지 액션 시트 — 모바일은 하단 sheet, 데스크탑은 중앙 모달. */
export function ProfileImageMenu({
  hasCustomImage,
  pending,
  onClose,
  onPickFile,
  onRevert,
}: Props) {
  return (
    <ModalShell
      label="프로필 사진"
      align="bottom"
      onDismiss={pending ? undefined : onClose}
      panelClassName="w-full max-w-[400px] overflow-hidden rounded-t-[20px] bg-white pb-[max(12px,env(safe-area-inset-bottom))] shadow-[0_24px_60px_rgba(15,23,42,0.22)] sm:rounded-[20px] sm:pb-3"
    >
      <div className="px-5 pb-2 pt-5">
        <h2 className="text-[16px] font-bold text-[#191F28]">프로필 사진</h2>
        <p className="mt-1 text-[12px] text-[#8B95A1]">JPG, PNG, WebP · 최대 5MB</p>
      </div>
      <div className="flex flex-col px-3 pt-1">
        <button
          type="button"
          onClick={onPickFile}
          disabled={pending}
          className="flex h-12 items-center gap-3 rounded-[12px] px-3 text-left text-[15px] font-semibold text-[#191F28] hover:bg-[#F2F4F6] disabled:opacity-50"
        >
          <span className="flex size-8 items-center justify-center rounded-full bg-[#EAF2FF] text-[#3182F6]">
            <CameraIcon />
          </span>
          <span>프로필 사진 변경</span>
        </button>
        {hasCustomImage ? (
          <button
            type="button"
            onClick={onRevert}
            disabled={pending}
            className="flex h-12 items-center gap-3 rounded-[12px] px-3 text-left text-[15px] font-semibold text-[#F04452] hover:bg-[#FFECEE] disabled:opacity-50"
          >
            <span className="flex size-8 items-center justify-center rounded-full bg-[#FFECEE] text-[#F04452]">
              <TrashIcon />
            </span>
            <span>기본 이미지로 복구</span>
          </button>
        ) : null}
      </div>
      <div className="mt-2 border-t border-[#F2F4F6] p-3">
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="flex h-11 w-full items-center justify-center rounded-[12px] text-[14px] font-bold text-[#6B7684] hover:bg-[#FAFBFC] disabled:opacity-50"
        >
          취소
        </button>
      </div>
    </ModalShell>
  );
}

function CameraIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 8h3l2-2h6l2 2h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13" r="3.2" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}
