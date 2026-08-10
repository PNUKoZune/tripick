'use client';

import { useEffect, useState } from 'react';
import type { InboxToastDto } from '@tripick/types';

import { getStoredSession } from '@/entities/session/model/session-storage';
import { getRealtimeSocket } from '@/shared/realtime';

/**
 * 앱 전역 인박스 토스트 구독.
 *
 * 서버가 인증 소켓을 `inbox:{userId}` room 에 자동 합류시키므로 join emit 은 없다.
 * `inbox_toast` 수신 시 가장 최근 토스트를 상태로 들고, 자동 닫힘 타이머를 건다.
 * 세션이 없으면(로그인 전) 소켓을 건드리지 않아 미인증 페이지에서 연결을 시도하지 않는다.
 */
export function useInboxToastSubscription() {
  const [toast, setToast] = useState<InboxToastDto | null>(null);

  useEffect(() => {
    if (!getStoredSession()) return;

    let active = true;
    const socket = getRealtimeSocket();

    const handleToast = (payload: InboxToastDto) => {
      if (!active) return;
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
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  return { toast, dismiss: () => setToast(null) };
}
