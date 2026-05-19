'use client';

import { QueryClient } from '@tanstack/react-query';

const SECOND = 1000;
const MINUTE = 60 * SECOND;

type QueryError = Error & { status?: number };

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: MINUTE,
        gcTime: 10 * MINUTE,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          const status = (error as QueryError).status;
          if (status && status < 500) {
            return false;
          }
          return failureCount < 2;
        },
      },
      mutations: {
        retry: false,
      },
    },
  });
}
