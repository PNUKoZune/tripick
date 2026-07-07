/// <reference types="jest" />

import { buildPreferenceText } from '../../src/preferences/preference-text';
import type { PreferenceProfileDto, TasteTagDto } from '@tripick/types';

const EMPTY_TAGS: TasteTagDto = { food: [], mood: [], environment: [], confidence: 0 };

const BASE_PROFILE: PreferenceProfileDto = {
  travelStyles: [],
  companions: [],
  sleepTime: '23:00',
  wakeTime: '07:30',
  transportModes: [],
  interests: [],
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

  it('emits shared English place-tag vocabulary for interests (hash-fallback alignment)', () => {
    const text = buildPreferenceText(EMPTY_TAGS, { ...BASE_PROFILE, interests: ['nature'] });
    const tokens = text.split(', ');
    // place 태그 어휘(inferPlaceTags)와 겹치는 영문 토큰이 있어야 한다
    expect(tokens).toContain('nature');
    expect(tokens).toContain('mountain');
  });

  it('emits shared English place-tag vocabulary for travel styles', () => {
    const text = buildPreferenceText(EMPTY_TAGS, { ...BASE_PROFILE, travelStyles: ['korean_vibe'] });
    const tokens = text.split(', ');
    expect(tokens).toContain('korean');
    expect(tokens).toContain('cultural');
  });

  it('deduplicates repeated tokens across sources', () => {
    const text = buildPreferenceText(
      { ...EMPTY_TAGS, food: ['cafe'] },
      { ...BASE_PROFILE, interests: ['cafe'] },
    );
    const cafeCount = text.split(', ').filter((t) => t === 'cafe').length;
    expect(cafeCount).toBe(1);
  });
});
