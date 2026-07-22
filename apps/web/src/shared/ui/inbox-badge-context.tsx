'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * nav 인박스 배지가 읽는 미읽음 수 통로.
 *
 * shared 는 계약(context)만 정의하고 값은 상위(app/feature)가 `InboxBadgeProvider` 로 주입한다.
 * 이렇게 해야 nav(shared/ui)가 entities/features(인박스 데이터·소켓)를 직접 임포트하지 않고
 * 순수하게 유지된다. 미주입 시 0(배지 없음).
 */
const InboxBadgeContext = createContext<number>(0);

export function InboxBadgeProvider({ value, children }: { value: number; children: ReactNode }) {
  return <InboxBadgeContext.Provider value={value}>{children}</InboxBadgeContext.Provider>;
}

export function useInboxUnreadCount(): number {
  return useContext(InboxBadgeContext);
}
