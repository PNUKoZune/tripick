/// <reference types="jest" />

import {
  distributeFallbackDurations,
  itemsFittingRemaining,
  maxVisitDuration,
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

  /**
   * 상한이 전역 150 하나뿐이던 시절엔 활동 구간이 길수록 카페·음식점까지 차례로 150 이 됐다.
   * 끼니 2시간 반·카페 2시간 반은 그 자체로 비현실적이고, 그만큼 볼거리에서 빠진 시간이다.
   */
  it('활동 구간이 길어도 카페·음식점은 자기 상한을 넘지 않는다', () => {
    const categories = ['attraction', 'restaurant', 'cafe', 'attraction'];
    const durations = distributeFallbackDurations(categories, '07:00', '23:00');

    expect(durations).toEqual([150, 120, 90, 150]);
  });

  it('상한 합계보다 목표가 크면 거기서 멈춘다 (채우려고 헛돌지 않는다)', () => {
    const categories = ['restaurant', 'cafe'];
    // 16시간의 80% 는 768분이지만 두 항목의 상한 합계는 210분뿐이다.
    const durations = distributeFallbackDurations(categories, '07:00', '23:00');

    expect(durations).toEqual([120, 90]);
  });

  it('짧은 하루에서는 상한에 닿지 않아 종전대로 비례 배분된다', () => {
    const durations = distributeFallbackDurations(['attraction', 'restaurant', 'cafe'], '13:00', '19:00');

    expect(durations.reduce((sum, duration) => sum + duration, 0)).toBe(288);
    expect(durations.every((duration) => duration >= 45)).toBe(true);
  });

  it('상한은 카테고리별이다', () => {
    expect(maxVisitDuration('cafe')).toBe(90);
    expect(maxVisitDuration('restaurant')).toBe(120);
    expect(maxVisitDuration('attraction')).toBe(150);
    expect(maxVisitDuration('park')).toBe(150);
  });
});
