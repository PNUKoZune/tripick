'use client';

import type { ReactNode } from 'react';

import { InboxBadgeProvider } from '@/shared/ui';

import { useInboxUnread } from '../model/use-inbox-unread';

/**
 * 전역 인박스 미읽음 수를 구독해 shared 의 nav 배지 context 에 주입한다.
 * providers 에서 앱 트리를 감싸 nav(shared/ui)가 순수한 채로 배지를 그릴 수 있게 한다.
 */
export function InboxUnreadBadgeProvider({ children }: { children: ReactNode }) {
  const unreadCount = useInboxUnread();
  return <InboxBadgeProvider value={unreadCount}>{children}</InboxBadgeProvider>;
}
