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

  it('adds Korean keywords for taste tags so photo signal overlaps place text', () => {
    const text = buildPreferenceText(
      { ...EMPTY_TAGS, food: ['japanese'], confidence: 0.8 },
      BASE_PROFILE,
    );
    const tokens = text.split(', ');
    expect(tokens).toContain('japanese');
    expect(tokens).toContain('일식');
  });
});

/**
 * 토큰 반복이 곧 비중이다 (원격 모델 평균 풀링·해시 폴백 누적 양쪽 모두).
 * 예전에는 Set 으로 중복을 지워서 사진 태그가 프로필 확장 토큰에 묻히고
 * 두 소스가 합의했다는 정보도 사라졌다.
 */
describe('buildPreferenceText 가중치', () => {
  const count = (text: string, token: string) =>
    text.split(', ').filter((t) => t === token).length;

  it('repeats a token when both photo and profile point at it', () => {
    const text = buildPreferenceText(
      { ...EMPTY_TAGS, food: ['cafe'], confidence: 0.9 },
      { ...BASE_PROFILE, likedThemes: ['cafe_dessert'] },
    );
    // 사진(신뢰도 0.9 → 3) + 프로필(1) = 4
    expect(count(text, 'cafe')).toBe(4);
  });

  it('weights photo tags by confidence', () => {
    const high = buildPreferenceText(
      { ...EMPTY_TAGS, environment: ['hotspring'], confidence: 1 },
      BASE_PROFILE,
    );
    const low = buildPreferenceText(
      { ...EMPTY_TAGS, environment: ['hotspring'], confidence: 0 },
      BASE_PROFILE,
    );
    expect(count(high, 'hotspring')).toBe(3);
    expect(count(low, 'hotspring')).toBe(1);
  });

  it('gives photo tags at least as much weight as profile tokens', () => {
    const text = buildPreferenceText(
      { ...EMPTY_TAGS, food: ['seafood'], confidence: 0.5 },
      { ...BASE_PROFILE, likedThemes: ['exhibition'] },
    );
    expect(count(text, 'seafood')).toBeGreaterThan(count(text, 'cultural'));
  });

  it('caps repetition so one token cannot dominate the vector', () => {
    const text = buildPreferenceText(
      { ...EMPTY_TAGS, food: ['cafe'], mood: ['healing'], confidence: 1 },
      // cafe_dessert·park_garden·local_street 가 모두 cafe/healing 을 밀어 올린다
      { ...BASE_PROFILE, likedThemes: ['cafe_dessert', 'park_garden', 'local_street'] },
    );
    expect(count(text, 'cafe')).toBeLessThanOrEqual(4);
    expect(count(text, 'healing')).toBeLessThanOrEqual(4);
  });

  it('orders tokens by weight, strongest first', () => {
    const text = buildPreferenceText(
      { ...EMPTY_TAGS, environment: ['island'], confidence: 1 },
      { ...BASE_PROFILE, likedThemes: ['exhibition'] },
    );
    expect(text.split(', ')[0]).toBe('island');
  });
});
