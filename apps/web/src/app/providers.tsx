'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { createQueryClient } from '@/shared/api/query-client';
import { RnBridge } from '@/shared/rn-bridge/rn-bridge';
import { ActiveTripFab } from '@/widgets/active-trip-fab';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <RnBridge />
      {children}
      <ActiveTripFab />
    </QueryClientProvider>
  );
}
