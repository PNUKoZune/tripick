/// <reference types="jest" />

import {
  distributeFallbackDurations,
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
