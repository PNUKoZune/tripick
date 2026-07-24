'use client';

import { useEffect, useRef } from 'react';

// 열린 순서대로 쌓이는 ESC 핸들러. 한 번 눌렀을 때 맨 위 모달만 반응해야 한다
// (모달마다 bare window 리스너를 걸면 ESC 한 번에 안쪽·바깥쪽이 다 닫힌다).
type Entry = { current: (() => void) | undefined };
const stack: Entry[] = [];
let listening = false;

function onKey(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  const top = stack[stack.length - 1];
  if (!top) return;
  // 맨 위 모달이 소비 — 닫을 수 없는(pending) 상태여도 아래 모달로 새지 않게 막기만 한다
  event.preventDefault();
  top.current?.();
}

/**
 * ESC 로 맨 위 모달을 닫는다. `onDismiss` 가 없으면(처리 중 등) ESC 를 삼키기만 하고
 * 아래 모달로 흘려보내지 않는다. 마운트 = 열림 규약을 따르는 오버레이에서 쓴다.
 */
export function useDismissOnEscape(onDismiss?: () => void, active = true) {
  const entry = useRef<(() => void) | undefined>(onDismiss);

  // 재구독 없이 최신 onDismiss 를 ESC 시점에 쓰도록 매 렌더 갱신 (render 중 ref 접근은 금지)
  useEffect(() => {
    entry.current = onDismiss;
  });

  useEffect(() => {
    if (!active) return;
    stack.push(entry);
    if (!listening) {
      document.addEventListener('keydown', onKey);
      listening = true;
    }
    return () => {
      const at = stack.indexOf(entry);
      if (at !== -1) stack.splice(at, 1);
      if (listening && stack.length === 0) {
        document.removeEventListener('keydown', onKey);
        listening = false;
      }
    };
  }, [active]);
}
