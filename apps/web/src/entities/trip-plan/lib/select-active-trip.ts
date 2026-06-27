import type { TripSummaryDto } from '@tripick/types';

export interface TripScheduleSplit {
  /** 오늘이 여행 기간(startDate~endDate) 안에 드는 진행 중 여행 (없으면 null) */
  active: TripSummaryDto | null;
  /** 시작일이 미래인 여행들 (가까운 순) */
  upcoming: TripSummaryDto[];
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * 오늘 기준으로 진행 중(active) 여행과 다가오는(upcoming) 여행을 분리한다.
 * 진행 중 여행은 한 시점에 하나라고 가정해 첫 번째 매칭을 active 로 본다.
 */
export function splitTripSchedule(
  trips: TripSummaryDto[],
  now: Date = new Date(),
): TripScheduleSplit {
  const today = startOfDay(now);

  const active =
    trips.find((trip) => {
      const start = startOfDay(new Date(trip.startDate));
      const end = startOfDay(new Date(trip.endDate));
      return start <= today && today <= end;
    }) ?? null;

  const upcoming = trips
    .filter((trip) => startOfDay(new Date(trip.startDate)) > today)
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

  return { active, upcoming };
}
