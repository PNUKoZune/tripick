import type { ReplanPace } from '@tripick/types';
import { getAwakeWindow } from '@tripick/utils';

const MIN_ITEMS_PER_DAY: Record<ReplanPace, number> = {
  relaxed: 3,
  balanced: 4,
  packed: 5,
};

const TARGET_WINDOW_COVERAGE: Record<ReplanPace, number> = {
  relaxed: 0.8,
  balanced: 0.88,
  packed: 0.96,
};

const MAX_ITEMS_PER_DAY = 7;
const ESTIMATED_VISIT_MINUTES = 120;
export const ESTIMATED_TRAVEL_MINUTES = 30;
const MIN_VISIT_MINUTES = 45;
const MAX_VISIT_MINUTES = 150;

export function minimumItemsPerDay(pace?: ReplanPace): number {
  return MIN_ITEMS_PER_DAY[pace ?? 'balanced'];
}

/**
 * 일정 강도별 3/4/5개는 최소 밀도로 두고, 활동 구간이 길면 예상 체류+이동시간으로
 * 필요한 슬롯을 늘린다. 24시간에 가까운 비정상 구간에서도 과밀해지지 않게 7개로 제한한다.
 */
export function targetItemsPerDay(
  pace: ReplanPace | undefined,
  wakeTime: string,
  sleepTime: string,
): number {
  const resolvedPace = pace ?? 'balanced';
  const window = getAwakeWindow(wakeTime, sleepTime);
  const targetSpan = window.lengthMinutes * TARGET_WINDOW_COVERAGE[resolvedPace];
  const estimatedSlotSpan = ESTIMATED_VISIT_MINUTES + ESTIMATED_TRAVEL_MINUTES;
  // 첫 장소까지의 이동은 일정에 포함하지 않으므로 한 구간을 다시 더해 역산한다.
  const adaptiveCount = Math.ceil((targetSpan + ESTIMATED_TRAVEL_MINUTES) / estimatedSlotSpan);

  return Math.min(MAX_ITEMS_PER_DAY, Math.max(MIN_ITEMS_PER_DAY[resolvedPace], adaptiveCount));
}

/**
 * 남은 활동 시간(분)에 현실적으로 들어가는 항목 수 상한.
 *
 * `targetItemsPerDay` 와 달리 **강도별 최소치(3/4/5)를 보장하지 않는다** — 오늘 일정을
 * "지금 이후"로 다시 짤 때는 남은 시간이 두 시간뿐일 수 있고, 그때도 4개를 배치하면
 * ScheduleConstraint 가 뒤 항목을 취침 직전으로 몰아 이동시간 위반이 나고 결정적 폴백까지
 * 실패해 요청 자체가 죽는다. 한 곳도 못 담으면 0 을 돌려 호출자가 그 일차를 건너뛰게 한다.
 */
export function itemsFittingRemaining(remainingMin: number): number {
  if (remainingMin < MIN_VISIT_MINUTES) return 0;
  const slotSpan = ESTIMATED_VISIT_MINUTES + ESTIMATED_TRAVEL_MINUTES;
  // 첫 장소까지의 이동은 남은 시간에 포함되지 않으므로 한 구간을 더해 역산한다.
  const fitting = Math.floor((remainingMin + ESTIMATED_TRAVEL_MINUTES) / slotSpan);
  // 체류시간을 최소치까지 줄이면 한 곳은 들어가므로 1 을 하한으로 둔다.
  return Math.min(MAX_ITEMS_PER_DAY, Math.max(1, fitting));
}

/**
 * LLM을 사용할 수 없을 때도 하루가 일찍 끝나지 않도록 체류시간 합계를 활동 구간의
 * 약 80%로 맞춘다. 나머지 시간은 장소 간 이동으로 채워지는 것을 전제로 한다.
 */
export function distributeFallbackDurations(
  categories: string[],
  wakeTime: string,
  sleepTime: string,
): number[] {
  if (categories.length === 0) return [];

  const window = getAwakeWindow(wakeTime, sleepTime);
  const targetTotal = Math.max(
    MIN_VISIT_MINUTES * categories.length,
    Math.min(MAX_VISIT_MINUTES * categories.length, Math.round(window.lengthMinutes * 0.8)),
  );
  const durations = categories.map(defaultVisitDuration);
  let delta = targetTotal - durations.reduce((sum, duration) => sum + duration, 0);

  const growOrder = categories
    .map((category, index) => ({ category, index }))
    .sort((a, b) => categoryGrowthPriority(a.category) - categoryGrowthPriority(b.category))
    .map(({ index }) => index);
  const shrinkOrder = [...growOrder].reverse();

  while (delta !== 0) {
    const order = delta > 0 ? growOrder : shrinkOrder;
    let changed = false;
    for (const index of order) {
      if (delta > 0 && durations[index]! < MAX_VISIT_MINUTES) {
        durations[index]! += 1;
        delta -= 1;
        changed = true;
      } else if (delta < 0 && durations[index]! > MIN_VISIT_MINUTES) {
        durations[index]! -= 1;
        delta += 1;
        changed = true;
      }
      if (delta === 0) break;
    }
    if (!changed) break;
  }

  return durations;
}

export function defaultVisitDuration(category: string): number {
  if (category === 'restaurant') return 90;
  if (category === 'cafe') return 60;
  return 120;
}

function categoryGrowthPriority(category: string): number {
  if (category === 'attraction' || category === 'park' || category === 'cultural') return 0;
  if (category === 'restaurant') return 1;
  if (category === 'cafe') return 3;
  return 2;
}
