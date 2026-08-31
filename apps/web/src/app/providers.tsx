'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { createQueryClient } from '@/shared/api/query-client';
import { RnBridge } from '@/shared/rn-bridge/rn-bridge';
import { ThemeProvider } from '@/shared/theme';
import { WebPush } from '@/shared/web-push';
import { ActiveTripFab } from '@/widgets/active-trip-fab';
import { SessionFlashToast } from '@/features/notify-session-flash';
import { InboxToast } from '@/features/subscribe-inbox-toast';
import { InboxUnreadBadgeProvider } from '@/features/subscribe-inbox-unread';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RnBridge />
        <WebPush />
        <InboxUnreadBadgeProvider>{children}</InboxUnreadBadgeProvider>
        <ActiveTripFab />
        <InboxToast />
        <SessionFlashToast />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
