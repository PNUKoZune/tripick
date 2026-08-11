'use client';

import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

import { useBodyScrollLock } from '@/shared/lib/use-body-scroll-lock';
import { useDismissOnEscape } from '@/shared/lib/use-dismiss-on-escape';
import { useFocusTrap } from '@/shared/lib/use-focus-trap';

type Props = {
  /** 스크린리더가 읽을 다이얼로그 이름 */
  label: string;
  /**
   * 백드롭 클릭·ESC 로 닫을 때 호출. 생략하면 두 경로 모두 막힌다 —
   * 처리 중(pending)처럼 닫히면 안 되는 상태에서 `undefined` 를 넘기면 된다.
   */
  onDismiss?: (() => void) | undefined;
  /** 패널 정렬. 'bottom' 은 모바일 하단 시트 → sm 이상에서 중앙 모달 */
  align?: 'center' | 'bottom';
  /** 패널(카드) 클래스 — 폭·패딩·라운드·배경은 모달마다 달라 통째로 받는다 */
  panelClassName?: string;
  /**
   * 켜면 포털 루트에 `.wvr-scope` 를 붙여 다크 토큰이 해석되게 한다.
   * 포털은 body 로 빠져 AppFrame 의 스코프를 못 받으므로, 토큰화된 모달만 opt-in 한다.
   * 기본 false — panelClassName·children 이 아직 토큰화 안 된 모달은 라이트 고정 유지.
   */
  themed?: boolean;
  children: ReactNode;
};

/**
 * 모달 공통 셸. body 스크롤 락·ESC·백드롭·포커스 트랩을 한곳에 모아둔다.
 * 열림 여부는 호출부가 조건부 렌더로 정한다(마운트 = 열림).
 */
export function ModalShell({
  label,
  onDismiss,
  align = 'center',
  panelClassName = '',
  themed = false,
  children,
}: Props) {
  const panelRef = useFocusTrap<HTMLDivElement>();

  useBodyScrollLock();
  useDismissOnEscape(onDismiss);

  // 조상의 transform·filter 에 fixed 오버레이가 갇히지 않게 body 로 포털.
  // 모달은 사용자 상호작용(마운트=열림)으로만 뜨므로 SSR 시점엔 렌더되지 않지만, 방어적으로 가드한다.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex justify-center ${themed ? 'wvr-scope ' : ''}${
        align === 'bottom' ? 'items-end p-0 sm:items-center sm:p-5' : 'items-center p-5'
      }`}
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      {/* 마우스 전용 닫기 영역 — 키보드·스크린리더에는 ESC 와 취소 버튼이 있어 탭 순서에서 뺀다 */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={onDismiss}
        disabled={!onDismiss}
        className="app-backdrop-in absolute inset-0 bg-black/45"
      />
      {/* 등장 모션만 있고 퇴장은 즉시 — 열림이 마운트라 언마운트를 지연할 곳이 없다.
          transform 은 애니메이션 종료 후 해제되므로 내부 fixed 요소를 가두지 않는다 */}
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`app-panel-in relative outline-none ${panelClassName}`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
