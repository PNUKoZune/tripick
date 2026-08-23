'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import {
  clearSessionFlash,
  getSessionFlashServerSnapshot,
  getSessionFlashSnapshot,
  parseSessionFlash,
  subscribeSessionFlash,
  type SessionFlash,
} from '@/entities/session';
import { usePrefersReducedMotion } from '@/shared/lib/use-prefers-reduced-motion';
import { Toast } from '@/shared/ui';

/** 퇴장 애니메이션 길이 — globals.css 의 `app-toast-out` 과 같아야 한다. */
const EXIT_MS = 200;
/** 자동 닫힘까지 머무는 시간. 인박스 토스트(6초)보다 짧다 — 읽을 문장이 한 줄이다. */
const VISIBLE_MS = 5000;

/**
 * 앱 전역에 마운트되는 세션 플래시 토스트(providers).
 * SessionGuard 가 로그인 화면으로 튕기면서 남긴 안내를 도착한 화면에서 대신 띄운다.
 *
 * 플래시를 로컬 state 로 복사하지 않고 스토어(sessionStorage)를 그대로 그린다 —
 * 복사하면 effect 안에서 setState 를 하게 되고(cascading render), 지우는 시점과
 * 화면에 남는 시점이 어긋난다. 대신 카드에 `key={raw}` 를 줘서 새 메시지마다
 * 퇴장 상태가 자연히 초기화되게 한다.
 */
export function SessionFlashToast() {
  const raw = useSyncExternalStore(
    subscribeSessionFlash,
    getSessionFlashSnapshot,
    getSessionFlashServerSnapshot,
  );
  const flash = useMemo(() => parseSessionFlash(raw), [raw]);

  if (!flash) return null;
  return <FlashCard key={raw} flash={flash} />;
}

function FlashCard({ flash }: { flash: SessionFlash }) {
  // 퇴장 애니메이션이 도는 동안 카드가 내용을 유지해야 해서 닫기는 두 단계다:
  // closing 을 먼저 켜고(내용 유지 + 퇴장 클래스) EXIT_MS 뒤에 플래시를 지운다.
  const [closing, setClosing] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  const dismiss = useCallback(() => {
    if (reducedMotion) {
      clearSessionFlash();
      return;
    }
    setClosing(true);
  }, [reducedMotion]);

  useEffect(() => {
    if (closing) return;
    const timer = setTimeout(dismiss, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [closing, dismiss]);

  // 퇴장이 끝나면 스토어에서 지운다 → 스냅샷이 null 이 되어 실제로 언마운트된다.
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(clearSessionFlash, EXIT_MS);
    return () => clearTimeout(timer);
  }, [closing]);

  return (
    <Toast
      tone={flash.tone ?? 'warning'}
      title={flash.title}
      closing={closing}
      {...(flash.message ? { message: flash.message } : {})}
      onClose={dismiss}
    />
  );
}
