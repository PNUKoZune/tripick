/// <reference types="jest" />

import { buildPreferenceText } from '../../src/preferences/preference-text';
import type { PreferenceProfileDto, TasteTagDto } from '@tripick/types';

const EMPTY_TAGS: TasteTagDto = { food: [], mood: [], environment: [], confidence: 0 };

const BASE_PROFILE: PreferenceProfileDto = {
  sleepTime: '23:00',
  wakeTime: '07:30',
  transportModes: [],
  likedThemes: [],
  dislikedThemes: [],
  pace: 'balanced',
  activityIntensity: 'moderate',
  crowdPreference: 'balanced',
  instagramConnected: false,
  instagramTags: [],
};

describe('buildPreferenceText', () => {
  it('returns empty string when there is no taste signal', () => {
    expect(buildPreferenceText(EMPTY_TAGS, BASE_PROFILE)).toBe('');
    expect(buildPreferenceText()).toBe('');
  });

  it('includes tasteTags enums directly', () => {
    const text = buildPreferenceText(
      { food: ['cafe'], mood: ['healing'], environment: ['beach'], confidence: 0.9 },
      BASE_PROFILE,
    );
    expect(text).toContain('cafe');
    expect(text).toContain('healing');
    expect(text).toContain('beach');
  });

  it('emits shared English place-tag vocabulary for liked themes (hash-fallback alignment)', () => {
    const text = buildPreferenceText(EMPTY_TAGS, {
      ...BASE_PROFILE,
      likedThemes: ['mountain_forest'],
    });
    const tokens = text.split(', ');
    // place 태그 어휘(inferPlaceTags)와 겹치는 영문 토큰이 있어야 한다
    expect(tokens).toContain('nature');
    expect(tokens).toContain('mountain');
  });

  it('ignores disliked themes (not a positive signal)', () => {
    const text = buildPreferenceText(EMPTY_TAGS, {
      ...BASE_PROFILE,
      dislikedThemes: ['mountain_forest'],
    });
    expect(text).toBe('');
  });

  it('deduplicates repeated tokens across sources', () => {
    const text = buildPreferenceText(
      { ...EMPTY_TAGS, food: ['cafe'] },
      { ...BASE_PROFILE, likedThemes: ['cafe_dessert'] },
    );
    const cafeCount = text.split(', ').filter((t) => t === 'cafe').length;
    expect(cafeCount).toBe(1);
  });
});
