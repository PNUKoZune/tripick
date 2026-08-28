'use client';

import { useState } from 'react';
import { LuCheck, LuChevronRight } from 'react-icons/lu';

import { Button } from './button';
import { LegalDocumentModal, type LegalDocumentKind } from './legal/legal-document-modal';

/**
 * 가입 경로가 공유하는 약관 동의 화면.
 *
 * 이용약관 제5조가 "약관에 동의하고 인증을 완료하면 회원가입이 성립"이라고 규정하므로,
 * **계정이 만들어지기 전에** 동의를 받는다.
 * - 이메일 가입: 이 화면을 먼저 통과해야 이메일·비밀번호 입력 폼이 나온다.
 * - 카카오: 카카오 인증에서 돌아온 뒤 이 화면을 띄우고, 동의해야 서버가 계정을 만든다
 *   (동의 없이 떠나면 계정이 아예 생기지 않는다 — `POST /auth/kakao/signup`).
 *
 * ⚠️ 전문은 **모달**로 띄운다. 페이지로 넘기면 입력하던 가입 폼이나 카카오 가입 코드가
 * 화면과 함께 날아가고, 새 탭도 답이 아니다 — RN 웹뷰(Android)는
 * `setSupportMultipleWindows` 가 기본 true 인데 셸에 `onOpenWindow` 핸들러가 없어
 * 새 창 요청이 화면에 붙지 않는다(죽은 링크).
 */

/** 필수 동의 항목. 선택 동의(마케팅 등)는 아직 없다 — 생기면 required:false 로 여기에 붙인다. */
const ITEMS = [
  { key: 'terms', label: '이용약관' },
  { key: 'privacy', label: '개인정보처리방침' },
] as const satisfies readonly { key: LegalDocumentKind; label: string }[];

type ItemKey = (typeof ITEMS)[number]['key'];

export function LegalConsentStep({
  submitLabel = '동의하고 계속',
  pending = false,
  error,
  onAgree,
  footer,
}: {
  submitLabel?: string;
  pending?: boolean;
  error?: string | null;
  onAgree: () => void;
  /** 버튼 아래 보조 액션(취소·다른 방법으로 로그인 등) */
  footer?: React.ReactNode;
}) {
  const [checked, setChecked] = useState<Record<ItemKey, boolean>>({
    terms: false,
    privacy: false,
  });
  const [openDoc, setOpenDoc] = useState<LegalDocumentKind | null>(null);
  const allChecked = ITEMS.every((item) => checked[item.key]);

  function toggleAll() {
    const next = !allChecked;
    setChecked({ terms: next, privacy: next });
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-[16px] border border-[color:var(--line)] bg-[color:var(--card)]">
        <button
          type="button"
          onClick={toggleAll}
          aria-pressed={allChecked}
          className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-[color:var(--card-soft)]"
        >
          <CheckMark checked={allChecked} size="lg" />
          <span className="text-[15px] font-bold text-[color:var(--ink)]">전체 동의</span>
        </button>
        <div className="border-t border-[color:var(--line)]">
          {ITEMS.map((item) => (
            <div key={item.key} className="flex items-center">
              <button
                type="button"
                onClick={() => setChecked((prev) => ({ ...prev, [item.key]: !prev[item.key] }))}
                aria-pressed={checked[item.key]}
                className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 pr-2 text-left"
              >
                <CheckMark checked={checked[item.key]} size="sm" />
                <span className="truncate text-[14px] text-[color:var(--ink-sub)]">
                  <span className="font-bold text-[color:var(--ink)]">(필수)</span> {item.label}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setOpenDoc(item.key)}
                aria-label={`${item.label} 전문 보기`}
                aria-haspopup="dialog"
                className="flex h-11 shrink-0 items-center gap-0.5 pl-1 pr-3 text-[13px] font-semibold text-[color:var(--ink-faint)] hover:text-[color:var(--ink)]"
              >
                보기
                <LuChevronRight className="size-4" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-[13px] font-semibold text-[color:var(--danger)]">
          {error}
        </p>
      ) : null}

      <Button type="button" size="md" fullWidth disabled={!allChecked || pending} onClick={onAgree}>
        {pending ? '처리 중…' : submitLabel}
      </Button>

      {footer}

      {openDoc ? <LegalDocumentModal doc={openDoc} onClose={() => setOpenDoc(null)} /> : null}
    </div>
  );
}

function CheckMark({ checked, size }: { checked: boolean; size: 'sm' | 'lg' }) {
  const box = size === 'lg' ? 'size-6' : 'size-5';
  const icon = size === 'lg' ? 'size-4' : 'size-3.5';
  return (
    <span
      aria-hidden
      className={`flex ${box} shrink-0 items-center justify-center rounded-full border transition-colors ${
        checked
          ? 'border-[color:var(--primary)] bg-[color:var(--primary)] text-white'
          : 'border-[color:var(--line)] bg-[color:var(--card)] text-[color:var(--line-dot)]'
      }`}
    >
      <LuCheck className={icon} strokeWidth={3} />
    </span>
  );
}
