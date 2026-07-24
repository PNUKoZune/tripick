'use client';

import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** 열린 순서대로 쌓이는 트랩 컨테이너. 모달 위에 모달이 뜨면 맨 위만 Tab 을 가져간다 */
const trapStack: HTMLElement[] = [];

/** 화면에 실제로 그려져 있는지 — display:none·hidden 요소는 탭 순서에서 뺀다 */
function isVisible(el: HTMLElement) {
  return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
}

/**
 * 모달이 떠 있는 동안 Tab 포커스를 컨테이너 안에 가둔다.
 * 열 때 컨테이너로 포커스를 옮기고(안쪽 첫 요소가 아니라 컨테이너 자신 — 입력란에
 * 커서가 튀어 모바일 키보드가 올라오는 걸 막는다), 닫힐 때 열기 전 요소로 되돌린다.
 * 반환한 ref 를 붙일 요소에는 `tabIndex={-1}` 이 필요하다.
 */
export function useFocusTrap<T extends HTMLElement = HTMLDivElement>(active = true) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const container = ref.current;
    if (!active || !container) return;

    const restoreTo = document.activeElement as HTMLElement | null;
    container.focus({ preventScroll: true });
    trapStack.push(container);

    const focusableItems = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isVisible);

    // 컨테이너 밖으로 새는 Tab 까지 잡아야 해서 document 에 건다 (컨테이너 리스너는
    // 포커스가 이미 배경으로 나가버린 뒤에는 호출되지 않는다).
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      if (trapStack[trapStack.length - 1] !== container) return;
      const items = focusableItems();
      event.preventDefault();
      if (items.length === 0) {
        container.focus({ preventScroll: true });
        return;
      }
      const activeEl = document.activeElement as HTMLElement | null;
      const inside = activeEl !== null && activeEl !== container && container.contains(activeEl);
      const index = inside ? items.indexOf(activeEl) : -1;
      const next = event.shiftKey
        ? items[(index <= 0 ? items.length : index) - 1]
        : items[index + 1 >= items.length ? 0 : index + 1];
      next?.focus();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const at = trapStack.indexOf(container);
      if (at !== -1) trapStack.splice(at, 1);
      if (restoreTo && document.contains(restoreTo)) restoreTo.focus({ preventScroll: true });
    };
  }, [active]);

  return ref;
}
