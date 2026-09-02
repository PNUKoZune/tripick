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
    find: jest.fn(async () => []),
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

/** 저장 상태를 주입할 수 있는 서비스 + 목 리포지토리 묶음. */
function makeService(stored: Partial<PreferenceEntity> | null = null) {
  const repo = {
    findOneBy: jest.fn(async () => stored),
    find: jest.fn(async () => []),
    create: jest.fn((value: Partial<PreferenceEntity>) => value),
    save: jest.fn(async (value: Partial<PreferenceEntity>) => value),
  };
  const embeddings = { embed: jest.fn(async () => [0.1, 0.2]) };
  const preferenceEmbeddings = {
    upsertUserEmbedding: jest.fn(async () => 'emb-1'),
    findVectorByUser: jest.fn(async () => [0.5, 0.6]),
    findVectorsByUsers: jest.fn(async () => new Map([['u1', [0.5, 0.6]]])),
  };
  const service = new PreferencesService(repo as any, embeddings as any, preferenceEmbeddings as any);
  return { service, repo, embeddings, preferenceEmbeddings };
}

describe('PreferencesService.findByUser', () => {
  it('저장된 취향 행을 userId 로 조회해 그대로 돌려준다', async () => {
    const row = storedPreference({});
    const { service, repo } = makeService(row);

    await expect(service.findByUser('u1')).resolves.toBe(row);
    expect(repo.findOneBy).toHaveBeenCalledWith({ userId: 'u1' });
  });

  it('없으면 null 을 돌려준다', async () => {
    const { service } = makeService(null);
    await expect(service.findByUser('u1')).resolves.toBeNull();
  });
});

describe('PreferencesService.getPreferenceVector', () => {
  it('저장된 취향 벡터 조회를 임베딩 리포지토리에 위임한다', async () => {
    const { service, preferenceEmbeddings } = makeService();

    await expect(service.getPreferenceVector('u1')).resolves.toEqual([0.5, 0.6]);
    expect(preferenceEmbeddings.findVectorByUser).toHaveBeenCalledWith('u1');
  });
});

describe('PreferencesService group batch reads', () => {
  it('deduplicates user ids for profile and vector queries', async () => {
    const { service, repo, preferenceEmbeddings } = makeService();

    await service.findByUsers(['u1', 'u1', 'u2']);
    await service.getPreferenceVectors(['u1', 'u1', 'u2']);

    expect(repo.find).toHaveBeenCalledWith({
      where: { userId: expect.any(Object) },
    });
    expect(preferenceEmbeddings.findVectorsByUsers).toHaveBeenCalledWith(['u1', 'u2']);
  });
});

describe('PreferencesService.setPhotoKeys', () => {
  it('취향 행이 없으면 기본값으로 새로 만들고 재임베딩하지 않는다', async () => {
    const { service, repo, embeddings } = makeService(null);

    const saved = await service.setPhotoKeys('u1', ['a.jpg', 'b.jpg']);

    expect(repo.create).toHaveBeenCalled();
    expect(saved.photoKeys).toEqual(['a.jpg', 'b.jpg']);
    // 태그가 바뀌지 않았으므로 원격 임베딩 호출은 건너뛴다.
    expect(embeddings.embed).not.toHaveBeenCalled();
  });

  it('남지 않은 사진의 photoTags·disabledPhotoTags 를 함께 정리한다', async () => {
    const stored: Partial<PreferenceEntity> = {
      photoKeys: ['a.jpg', 'b.jpg'],
      photoTags: {
        'a.jpg': { food: ['cafe'], mood: [], environment: [], confidence: 0.8 },
        'b.jpg': { food: ['korean'], mood: [], environment: [], confidence: 0.8 },
      } as any,
      disabledPhotoTags: { 'b.jpg': ['korean'] } as any,
    };
    const { service } = makeService(stored);

    const saved = await service.setPhotoKeys('u1', ['a.jpg']);

    expect(saved.photoKeys).toEqual(['a.jpg']);
    expect(Object.keys(saved.photoTags ?? {})).toEqual(['a.jpg']);
    expect(saved.disabledPhotoTags).toEqual({});
  });
});

describe('PreferencesService.upsert — 병합·임베딩', () => {
  it('행이 없으면 기본값 프로필로 새로 만들고 태그 배열을 중복 제거한다', async () => {
    const { service, repo } = makeService(null);

    const saved = await service.upsert('u1', {
      tasteTags: { food: ['cafe', 'cafe', 'korean'], mood: [], environment: [], confidence: 0.9 },
    });

    expect(repo.create).toHaveBeenCalled();
    expect(saved.tasteTags?.food).toEqual(['cafe', 'korean']);
    // 프로필을 안 보냈으므로 DEFAULT_PROFILE 이 채워진다.
    expect(saved.profile).toMatchObject({ sleepTime: '23:00', wakeTime: '07:30', pace: 'balanced' });
  });

  it('부분 dto 는 저장값 위에 병합된다 (안 보낸 축은 저장값 유지)', async () => {
    const stored = storedPreference({});
    stored.tasteTags = { food: ['korean'], mood: ['healing'], environment: ['beach'], confidence: 0.7 };
    const { service } = makeService(stored);

    const saved = await service.upsert('u1', {
      tasteTags: { food: ['cafe'] },
    });

    expect(saved.tasteTags?.food).toEqual(['cafe']);
    // 보내지 않은 mood/environment 는 저장값에서 온다.
    expect(saved.tasteTags?.mood).toEqual(['healing']);
    expect(saved.tasteTags?.environment).toEqual(['beach']);
  });

  it('취향 신호가 있으면 임베딩하고 embeddingId 를 반영한다', async () => {
    const { service, embeddings, preferenceEmbeddings } = makeService(null);

    const saved = await service.upsert('u1', {
      tasteTags: { food: ['cafe'], mood: [], environment: [], confidence: 0.9 },
    });

    expect(embeddings.embed).toHaveBeenCalledTimes(1);
    expect(preferenceEmbeddings.upsertUserEmbedding).toHaveBeenCalledTimes(1);
    expect(saved.embeddingId).toBe('emb-1');
  });

  it('취향 신호가 전혀 없으면 제네릭 벡터를 저장하지 않는다', async () => {
    const { service, embeddings, preferenceEmbeddings } = makeService(null);

    const saved = await service.upsert('u1', {
      tasteTags: { food: [], mood: [], environment: [], confidence: 0 },
    });

    // buildPreferenceText 가 빈 문자열이면 embed·upsert 를 건너뛴다.
    expect(embeddings.embed).not.toHaveBeenCalled();
    expect(preferenceEmbeddings.upsertUserEmbedding).not.toHaveBeenCalled();
    expect(saved.embeddingId).toBeUndefined();
  });
});
