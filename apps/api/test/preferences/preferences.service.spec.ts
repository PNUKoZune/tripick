/// <reference types="jest" />

import { BadRequestException } from '@nestjs/common';
import { PreferencesService } from '../../src/preferences/preferences.service';
import type { PreferenceEntity } from '../../src/preferences/preference.entity';
import type { PreferenceProfileDto } from '@tripick/types';

/** 저장돼 있는 취향 행. profile 은 항상 전체 필드를 갖는다. */
function storedPreference(profile: Partial<PreferenceProfileDto>): Partial<PreferenceEntity> {
  return {
    tasteTags: { food: [], mood: [], environment: [], confidence: 0 },
    profile: {
      sleepTime: '23:00',
      wakeTime: '07:30',
      transportModes: [],
      likedThemes: [],
      dislikedThemes: [],
      pace: 'balanced',
      activityIntensity: 'moderate',
      crowdPreference: 'balanced',
      ...profile,
    },
  };
}

describe('PreferencesService.upsert — 기상/취침 시간 교차 검증', () => {
  let stored: Partial<PreferenceEntity> | null;
  let service: PreferencesService;

  const repo = {
    findOneBy: jest.fn(async () => stored),
    create: jest.fn((value: Partial<PreferenceEntity>) => value),
    save: jest.fn(async (value: Partial<PreferenceEntity>) => value),
  };
  const embeddings = { embed: jest.fn(async () => [0.1, 0.2]) };
  const preferenceEmbeddings = { upsertUserEmbedding: jest.fn(async () => 'emb-1') };

  beforeEach(() => {
    stored = null;
    jest.clearAllMocks();
    service = new PreferencesService(repo as any, embeddings as any, preferenceEmbeddings as any);
  });

  it('rejects a profile whose wake and sleep time are the same', async () => {
    // 활동 0분과 24시간 중 무엇을 뜻하는지 정할 수 없다.
    await expect(
      service.upsert('u1', { tasteTags: {}, profile: { wakeTime: '08:00', sleepTime: '08:00' } }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('rejects when the incoming half collides with the stored half', async () => {
    // dto 가 sleepTime 만 보내도 wakeTime 은 저장값에서 온다. 들어온 필드만 보면 통과한다.
    stored = storedPreference({ wakeTime: '09:00', sleepTime: '23:00' });

    await expect(
      service.upsert('u1', { tasteTags: {}, profile: { sleepTime: '09:00' } }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a night owl profile that crosses midnight', async () => {
    await expect(
      service.upsert('u1', { tasteTags: {}, profile: { wakeTime: '08:00', sleepTime: '01:00' } }),
    ).resolves.toMatchObject({ profile: { wakeTime: '08:00', sleepTime: '01:00' } });
  });
});
