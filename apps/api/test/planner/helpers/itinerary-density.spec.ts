/// <reference types="jest" />

import {
  distributeFallbackDurations,
  itemsFittingRemaining,
  minimumItemsPerDay,
  targetItemsPerDay,
} from '../../../src/planner/helpers/itinerary-density';

describe('itinerary density', () => {
  it('keeps 3/4/5 as the minimum density for a shorter activity window', () => {
    expect(minimumItemsPerDay('relaxed')).toBe(3);
    expect(minimumItemsPerDay('balanced')).toBe(4);
    expect(minimumItemsPerDay('packed')).toBe(5);

    expect(targetItemsPerDay('relaxed', '09:00', '17:00')).toBe(3);
    expect(targetItemsPerDay('balanced', '09:00', '17:00')).toBe(4);
    expect(targetItemsPerDay('packed', '09:00', '17:00')).toBe(5);
  });

  it('adds slots when a long activity window would otherwise end early', () => {
    expect(targetItemsPerDay('relaxed', '09:00', '22:00')).toBe(5);
    expect(targetItemsPerDay('balanced', '09:00', '22:00')).toBe(5);
    expect(targetItemsPerDay('packed', '09:00', '22:00')).toBe(6);
  });

  it('sizes a partial day by the time actually left, ignoring the pace minimum', () => {
    // 오늘 남은 시간으로 재계획하는 경로. 강도별 최소(3/4/5)를 따르면 남은 2시간에 4곳을
    // 밀어넣어 검증이 깨지므로, 여기서는 최소치를 보장하지 않는 게 정상 동작이다.
    expect(itemsFittingRemaining(410)).toBe(2); // 15:10 → 22:00
    expect(itemsFittingRemaining(120)).toBe(1);
    expect(itemsFittingRemaining(60)).toBe(1); // 체류를 45분까지 줄이면 한 곳은 들어간다
    expect(itemsFittingRemaining(44)).toBe(0); // 한 곳도 못 담으면 그 일차는 건너뛴다
    expect(itemsFittingRemaining(0)).toBe(0);
    // 하루 전체(기상~취침)를 넣어도 과밀 상한(7)을 넘지 않는다.
    expect(itemsFittingRemaining(24 * 60)).toBe(7);
  });

  it('fills about 80% of the activity window with fallback visit durations', () => {
    const durations = distributeFallbackDurations(
      ['attraction', 'restaurant', 'attraction', 'cafe', 'attraction'],
      '09:00',
      '22:00',
    );

    expect(durations).toHaveLength(5);
    expect(durations.reduce((sum, duration) => sum + duration, 0)).toBe(624);
    expect(durations.every((duration) => duration >= 45 && duration <= 150)).toBe(true);
  });
});
