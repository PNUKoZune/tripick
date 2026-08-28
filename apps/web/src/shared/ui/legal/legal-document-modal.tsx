'use client';

import { LuX } from 'react-icons/lu';

import { LEGAL_UPDATED_AT } from '@/shared/config/contact';
import { ModalShell } from '@/shared/ui/modal-shell';
import { PrivacyContent } from './privacy-content';
import { TermsContent } from './terms-content';

export type LegalDocumentKind = 'terms' | 'privacy';

const TITLE: Record<LegalDocumentKind, string> = {
  terms: '이용약관',
  privacy: '개인정보처리방침',
};

/**
 * 약관 전문을 화면 위에 띄운다. 가입 동의 화면에서 페이지로 넘기지 않는 이유:
 * - 이메일 가입은 입력 중이던 폼이, 카카오는 서버가 준 가입 코드가 이동과 함께 날아간다.
 * - 새 탭도 답이 아니다 — RN 웹뷰(Android)는 `setSupportMultipleWindows` 가 기본 true 인데
 *   셸에 `onOpenWindow` 핸들러가 없어 새 창 요청이 화면에 안 붙는다(죽은 링크).
 *
 * 본문은 문서 페이지와 **같은 컴포넌트**를 쓴다. 복사해 두면 한쪽만 개정된다.
 */
export function LegalDocumentModal({
  doc,
  onClose,
}: {
  doc: LegalDocumentKind;
  onClose: () => void;
}) {
  return (
    <ModalShell
      label={TITLE[doc]}
      onDismiss={onClose}
      align="bottom"
      themed
      panelClassName="flex max-h-[85dvh] w-full max-w-[560px] flex-col overflow-hidden rounded-t-[20px] bg-[color:var(--bg)] sm:max-h-[80dvh] sm:rounded-[20px]"
    >
      <header className="flex items-start gap-3 border-b border-[color:var(--line)] bg-[color:var(--card)] px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-bold text-[color:var(--ink)]">{TITLE[doc]}</h2>
          <p className="mt-0.5 text-[12px] text-[color:var(--ink-faint)]">
            시행일 {LEGAL_UPDATED_AT}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className="-mr-1 -mt-1 flex size-9 shrink-0 items-center justify-center rounded-full text-[color:var(--ink-sub)] hover:bg-[color:var(--card-soft)]"
        >
          <LuX className="size-5" aria-hidden />
        </button>
      </header>

      {/* 본문만 스크롤 — 헤더와 닫기 버튼은 긴 문서에서도 계속 보여야 한다. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        <div className="space-y-4">
          {doc === 'terms' ? <TermsContent linkable={false} /> : <PrivacyContent />}
        </div>
      </div>
    </ModalShell>
  );
}
