'use client';

import { useEffect, useMemo, useState } from 'react';
import type { PlannerItineraryItemDto } from '@tripick/types';

export type ItemProgress = 'done' | 'current' | 'upcoming';

export interface ProgressItem {
  item: PlannerItineraryItemDto;
  progress: ItemProgress;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function currentMinutes(now = new Date()): number {
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * 일정 항목들을 현재 시각 기준으로 done/current/upcoming 으로 파생한다.
 * current = 시작 시각이 지난 마지막 항목. 1분마다 갱신한다.
 */
export function useTripProgress(items: PlannerItineraryItemDto[]) {
  const [nowMin, setNowMin] = useState(() => currentMinutes());

  useEffect(() => {
    const id = setInterval(() => setNowMin(currentMinutes()), 60_000);
    return () => clearInterval(id);
  }, []);

  return useMemo(() => {
    const sorted = [...items].sort(
      (a, b) => toMinutes(a.scheduledAt) - toMinutes(b.scheduledAt),
    );

    let currentIndex = -1;
    for (let i = 0; i < sorted.length; i += 1) {
      if (toMinutes(sorted[i]!.scheduledAt) <= nowMin) currentIndex = i;
      else break;
    }

    const progressItems: ProgressItem[] = sorted.map((item, i) => ({
      item,
      progress: i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'upcoming',
    }));

    return {
      items: progressItems,
      currentItem: currentIndex >= 0 ? (sorted[currentIndex] ?? null) : null,
      nextItem: sorted[currentIndex + 1] ?? null,
    };
  }, [items, nowMin]);
}
