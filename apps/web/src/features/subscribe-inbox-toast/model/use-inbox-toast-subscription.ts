'use client';

import { useCallback, useEffect, useState } from 'react';
import type { InboxToastDto } from '@tripick/types';

import { getStoredSession } from '@/entities/session/model/session-storage';
import { usePrefersReducedMotion } from '@/shared/lib/use-prefers-reduced-motion';
import { getRealtimeSocket } from '@/shared/realtime';

/** 퇴장 애니메이션 길이 — globals.css 의 `app-toast-out` 과 같아야 한다. */
const EXIT_MS = 200;

/**
 * 앱 전역 인박스 토스트 구독.
 *
 * 서버가 인증 소켓을 `inbox:{userId}` room 에 자동 합류시키므로 join emit 은 없다.
 * `inbox_toast` 수신 시 가장 최근 토스트를 상태로 들고, 자동 닫힘 타이머를 건다.
 * 세션이 없으면(로그인 전) 소켓을 건드리지 않아 미인증 페이지에서 연결을 시도하지 않는다.
 */
export function useInboxToastSubscription() {
  const [toast, setToast] = useState<InboxToastDto | null>(null);
  // 퇴장 애니메이션이 도는 동안에도 카드가 내용을 유지해야 해서, 닫기는 두 단계로 나눈다:
  // closing 을 먼저 켜고(내용 유지 + 퇴장 클래스) EXIT_MS 뒤에 payload 를 비운다.
  const [closing, setClosing] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  const dismiss = useCallback(() => {
    if (reducedMotion) {
      setToast(null);
      return;
    }
    setClosing(true);
  }, [reducedMotion]);

  useEffect(() => {
    if (!getStoredSession()) return;

    let active = true;
    const socket = getRealtimeSocket();

    const handleToast = (payload: InboxToastDto) => {
      if (!active) return;
      setClosing(false);
      setToast(payload);
    };

    socket.on('inbox_toast', handleToast);
    return () => {
      active = false;
      socket.off('inbox_toast', handleToast);
    };
  }, []);

  // 토스트가 뜰 때마다 6초 뒤 자동 닫힘(사용자가 직접 닫거나 탭하면 즉시 사라짐)
  useEffect(() => {
    if (!toast || closing) return;
    const timer = setTimeout(dismiss, 6000);
    return () => clearTimeout(timer);
  }, [toast, closing, dismiss]);

  // 퇴장 애니메이션이 끝나면 payload 를 비워 실제로 언마운트시킨다.
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => {
      setToast(null);
      setClosing(false);
    }, EXIT_MS);
    return () => clearTimeout(timer);
  }, [closing]);

  return { toast, closing, dismiss };
}
