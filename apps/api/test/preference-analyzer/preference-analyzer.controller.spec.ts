/// <reference types="jest" />

import { BadRequestException, ServiceUnavailableException, NotFoundException } from '@nestjs/common';
import type { TasteTagDto } from '@tripick/types';
import { PreferenceAnalyzerController } from '../../src/preference-analyzer/preference-analyzer.controller';
import { VisionAnalyzer } from '../../src/preference-analyzer/vision.analyzer';
import type { UserEntity } from '../../src/users/user.entity';

function tags(partial: Partial<TasteTagDto> = {}): TasteTagDto {
  return { food: [], mood: [], environment: [], confidence: 0, ...partial };
}

const user = { id: 'u1' } as UserEntity;

function file(mimetype = 'image/png') {
  return { mimetype, buffer: Buffer.from('img') };
}

function makeController(overrides: {
  findByUser?: jest.Mock;
  upsert?: jest.Mock;
  setPhotoKeys?: jest.Mock;
  isPrivateReady?: jest.Mock;
  putPrivateObject?: jest.Mock;
  enqueue?: jest.Mock;
  getStatus?: jest.Mock;
  findActiveJob?: jest.Mock;
  deletePrivateObject?: jest.Mock;
  signedUrls?: jest.Mock;
} = {}) {
  const visionAnalyzer = new VisionAnalyzer({ get: <T>(_k: string, d?: T) => d } as any);
  const analysisService = {
    enqueue: overrides.enqueue ?? jest.fn().mockResolvedValue({ jobId: 'job-1', status: 'queued' }),
    getStatus: overrides.getStatus ?? jest.fn().mockResolvedValue(null),
    findActiveJob: overrides.findActiveJob ?? jest.fn().mockResolvedValue(null),
  };
  const preferencesService = {
    findByUser: overrides.findByUser ?? jest.fn().mockResolvedValue(null),
    upsert: overrides.upsert ?? jest.fn().mockResolvedValue({ photoKeys: [], tasteTags: tags() }),
    setPhotoKeys:
      overrides.setPhotoKeys ?? jest.fn().mockResolvedValue({ photoKeys: [], tasteTags: tags() }),
  };
  const storage = {
    // 취향 사진은 비공개 버킷만 쓴다 — 컨트롤러가 isPrivateReady 를 본다.
    isPrivateReady: overrides.isPrivateReady ?? jest.fn().mockReturnValue(true),
    // 비공개 업로드는 URL 이 아니라 키를 돌려준다(공개 URL 이 존재하지 않는다).
    putPrivateObject:
      overrides.putPrivateObject ?? jest.fn(async ({ key }: { key: string }) => key),
    deletePrivateObject: overrides.deletePrivateObject ?? jest.fn().mockResolvedValue(undefined),
    signedUrls:
      overrides.signedUrls ??
      jest.fn(async (keys: string[]) => keys.map((key) => `/storage-private/${key}?sig=x`)),
  };

  const controller = new PreferenceAnalyzerController(
    visionAnalyzer,
    analysisService as any,
    preferencesService as any,
    storage as any,
  );
  return { controller, analysisService, preferencesService, storage };
}

describe('PreferenceAnalyzerController.uploadImages', () => {
  it('stores the photos and enqueues an analysis job', async () => {
    const { controller, analysisService, preferencesService } = makeController();

    const result = await controller.uploadImages(user, [file(), file()] as any);

    expect(result).toMatchObject({ jobId: 'job-1' });
    // 분석 전이라도 올린 사진은 바로 보여야 하므로 photoUrls 를 먼저 저장한다.
    const [, urls] = preferencesService.setPhotoKeys.mock.calls[0];
    expect(urls).toHaveLength(2);
    // 태그가 아직 안 바뀌었으므로 재임베딩을 부르는 upsert 는 타지 않는다.
    expect(preferencesService.upsert).not.toHaveBeenCalled();
    expect(analysisService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', photoKeys: expect.any(Array) }),
      expect.any(Array),
    );
  });

  it('re-queues photos a previous job failed to analyze', async () => {
    const { controller, analysisService } = makeController({
      findByUser: jest.fn().mockResolvedValue({
        photoKeys: ['preferences/u1/done.png', 'preferences/u1/stranded.png'],
        // stranded 는 이전 잡이 재시도까지 실패해 결과가 없다
        photoTags: { 'preferences/u1/done.png': tags({ food: ['cafe'], confidence: 0.8 }) },
      }),
    });

    await controller.uploadImages(user, [file()] as any);

    const [jobData] = analysisService.enqueue.mock.calls[0];
    expect(jobData.photoKeys).toHaveLength(2);
    // 식별자와 스토리지 키가 하나가 됐다 — 예전엔 photoUrls/storageKeys 두 배열을 짝지었다.
    expect(jobData.photoKeys[0]).toBe('preferences/u1/stranded.png');
    // 이미 분석된 사진은 다시 태우지 않는다
    expect(jobData.photoKeys).not.toContain('preferences/u1/done.png');
  });

  it('appends to the photos already stored', async () => {
    const { controller, preferencesService } = makeController({
      findByUser: jest.fn().mockResolvedValue({ photoKeys: ['preferences/u1/old.png'] }),
    });

    await controller.uploadImages(user, [file()] as any);

    const [, urls] = preferencesService.setPhotoKeys.mock.calls[0];
    expect(urls[0]).toBe('preferences/u1/old.png');
    expect(urls).toHaveLength(2);
  });

  it('rejects uploads that would exceed the total photo cap', async () => {
    const { controller, storage } = makeController({
      findByUser: jest.fn().mockResolvedValue({
        photoKeys: Array.from({ length: 9 }, (_, i) => `preferences/u1/${i}.png`),
      }),
    });

    await expect(controller.uploadImages(user, [file(), file()] as any)).rejects.toThrow(
      BadRequestException,
    );
    // 한도를 넘으면 스토리지에 아무것도 쓰지 않는다.
    expect(storage.putPrivateObject).not.toHaveBeenCalled();
  });

  it('allows an upload that exactly fills the cap', async () => {
    const { controller } = makeController({
      findByUser: jest.fn().mockResolvedValue({
        photoKeys: Array.from({ length: 8 }, (_, i) => `preferences/u1/${i}.png`),
      }),
    });

    await expect(controller.uploadImages(user, [file(), file()] as any)).resolves.toBeDefined();
  });

  it('refuses when object storage is not configured', async () => {
    const { controller } = makeController({ isPrivateReady: jest.fn().mockReturnValue(false) });

    await expect(controller.uploadImages(user, [file()] as any)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('rejects an empty upload', async () => {
    const { controller } = makeController();

    await expect(controller.uploadImages(user, [] as any)).rejects.toThrow(BadRequestException);
  });

  it('rejects more than the per-upload limit with a readable message', async () => {
    const { controller, storage } = makeController();

    await expect(
      controller.uploadImages(user, [file(), file(), file(), file()] as any),
    ).rejects.toThrow('사진은 한 번에 3장까지 올릴 수 있습니다.');
    expect(storage.putPrivateObject).not.toHaveBeenCalled();
  });
});

describe('PreferenceAnalyzerController.reanalyze', () => {
  const withStranded = {
    photoKeys: ['preferences/u1/done.png', 'preferences/u1/stranded.png'],
    photoTags: { 'preferences/u1/done.png': tags({ food: ['cafe'], confidence: 0.8 }) },
  };

  it('queues only the photos that have no analysis result', async () => {
    const { controller, analysisService } = makeController({
      findByUser: jest.fn().mockResolvedValue(withStranded),
    });

    await expect(controller.reanalyze(user)).resolves.toMatchObject({ jobId: 'job-1' });

    const [jobData, allUrls] = analysisService.enqueue.mock.calls[0];
    expect(jobData.photoKeys).toEqual(['preferences/u1/stranded.png']);
    // 보관 목록은 그대로 — 재분석은 사진을 추가하지 않는다
    expect(allUrls).toEqual(withStranded.photoKeys);
  });

  it('works at the photo cap, where a new upload cannot piggyback', async () => {
    const { controller, analysisService, storage } = makeController({
      findByUser: jest.fn().mockResolvedValue({
        photoKeys: Array.from({ length: 10 }, (_, i) => `preferences/u1/${i}.png`),
        photoTags: {},
      }),
    });

    await controller.reanalyze(user);

    expect(analysisService.enqueue.mock.calls[0][0].photoKeys).toHaveLength(10);
    // 새 사진이 없으므로 스토리지에 쓰지 않는다
    expect(storage.putPrivateObject).not.toHaveBeenCalled();
  });

  it('returns the job already running instead of analyzing the same photos twice', async () => {
    const findActiveJob = jest.fn().mockResolvedValue({ jobId: 'job-live', status: 'running' });
    const { controller, analysisService } = makeController({
      findByUser: jest.fn().mockResolvedValue(withStranded),
      findActiveJob,
    });

    await expect(controller.reanalyze(user)).resolves.toMatchObject({ jobId: 'job-live' });
    expect(analysisService.enqueue).not.toHaveBeenCalled();
  });

  it('rejects when every photo already has a result', async () => {
    const { controller, analysisService } = makeController({
      findByUser: jest.fn().mockResolvedValue({
        photoKeys: ['preferences/u1/done.png'],
        photoTags: { 'preferences/u1/done.png': tags({ food: ['cafe'] }) },
      }),
    });

    await expect(controller.reanalyze(user)).rejects.toThrow('다시 분석할 사진이 없습니다.');
    expect(analysisService.enqueue).not.toHaveBeenCalled();
  });

  it('rejects when the user has no photos at all', async () => {
    const { controller } = makeController();
    await expect(controller.reanalyze(user)).rejects.toThrow(BadRequestException);
  });

  it('refuses when object storage is not configured', async () => {
    const { controller } = makeController({
      isPrivateReady: jest.fn().mockReturnValue(false),
      findByUser: jest.fn().mockResolvedValue(withStranded),
    });

    await expect(controller.reanalyze(user)).rejects.toThrow(ServiceUnavailableException);
  });
});

describe('PreferenceAnalyzerController.deletePhoto', () => {
  it('re-aggregates taste tags from the remaining photos', async () => {
    const upsert = jest.fn().mockResolvedValue({
      photoKeys: ['preferences/u1/b.png'],
      tasteTags: tags({ mood: ['healing'], confidence: 0.5 }),
    });
    const { controller, storage } = makeController({
      findByUser: jest.fn().mockResolvedValue({
        photoKeys: ['preferences/u1/a.png', 'preferences/u1/b.png'],
        photoTags: {
          'preferences/u1/a.png': tags({ food: ['korean'], confidence: 0.9 }),
          'preferences/u1/b.png': tags({ mood: ['healing'], confidence: 0.5 }),
        },
      }),
      upsert,
    });

    await controller.deletePhoto(user, 'preferences/u1/a.png');

    // 키가 곧 식별자라 URL→키 변환이 없다.
    expect(storage.deletePrivateObject).toHaveBeenCalledWith('preferences/u1/a.png');
    const [, dto] = upsert.mock.calls[0];
    // 지운 사진의 korean 은 사라지고 남은 사진의 healing 만 남는다.
    expect(dto.photoTags).toEqual({ 'preferences/u1/b.png': tags({ mood: ['healing'], confidence: 0.5 }) });
    expect(dto.tasteTags.food).toEqual([]);
    expect(dto.tasteTags.mood).toEqual(['healing']);
  });

  it('ignores a url that does not belong to the user', async () => {
    const upsert = jest.fn();
    const { controller, storage } = makeController({
      findByUser: jest.fn().mockResolvedValue({ photoKeys: ['preferences/u1/mine.png'], photoTags: {} }),
      upsert,
    });

    await controller.deletePhoto(user, 'preferences/u1/someone-else.png');

    expect(storage.deletePrivateObject).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('requires a url', async () => {
    const { controller } = makeController();
    await expect(controller.deletePhoto(user, undefined)).rejects.toThrow(BadRequestException);
  });
});

describe('PreferenceAnalyzerController.togglePhotoTag', () => {
  const stored = {
    photoKeys: ['preferences/u1/a.png', 'preferences/u1/b.png'],
    photoTags: {
      'preferences/u1/a.png': tags({ food: ['cafe'], mood: ['healing'], confidence: 0.8 }),
      'preferences/u1/b.png': tags({ food: ['cafe'], mood: ['romantic'], confidence: 0.6 }),
    },
    disabledPhotoTags: {},
  };

  it('turns a tag off and re-aggregates without it', async () => {
    const upsert = jest.fn().mockResolvedValue({ tasteTags: tags({ food: ['cafe'] }) });
    const { controller } = makeController({
      findByUser: jest.fn().mockResolvedValue(stored),
      upsert,
    });

    // healing 은 a 에서만 나온 태그라, 끄면 집계에서 완전히 사라진다
    const result = await controller.togglePhotoTag(user, {
      key: 'preferences/u1/a.png',
      tag: 'healing',
      enabled: false,
    });

    const [, dto] = upsert.mock.calls[0];
    expect(dto.disabledPhotoTags).toEqual({ 'preferences/u1/a.png': ['healing'] });
    expect(dto.tasteTags.mood).not.toContain('healing');
    // 다른 사진에서도 나온 cafe 는 그대로 남는다
    expect(dto.tasteTags.food).toEqual(['cafe']);
    // 화면이 바로 반영할 수 있게 사진별 상태를 함께 돌려준다
    expect(result.photos[0]).toEqual({
      key: 'preferences/u1/a.png',
      url: '/storage-private/preferences/u1/a.png?sig=x',
      analyzed: true,
      tags: [
        { tag: 'cafe', enabled: true },
        { tag: 'healing', enabled: false },
      ],
    });
  });

  it('turns a tag back on', async () => {
    const upsert = jest.fn().mockResolvedValue({ tasteTags: tags() });
    const { controller } = makeController({
      findByUser: jest
        .fn()
        .mockResolvedValue({ ...stored, disabledPhotoTags: { 'preferences/u1/a.png': ['cafe'] } }),
      upsert,
    });

    await controller.togglePhotoTag(user, {
      key: 'preferences/u1/a.png',
      tag: 'cafe',
      enabled: true,
    });

    const [, dto] = upsert.mock.calls[0];
    expect(dto.disabledPhotoTags).toEqual({});
    expect(dto.tasteTags.food).toEqual(['cafe']);
  });

  it('does not touch photoUrls or photoTags when toggling', async () => {
    const upsert = jest.fn().mockResolvedValue({ tasteTags: tags() });
    const { controller } = makeController({
      findByUser: jest.fn().mockResolvedValue(stored),
      upsert,
    });

    await controller.togglePhotoTag(user, {
      key: 'preferences/u1/a.png',
      tag: 'cafe',
      enabled: false,
    });

    const [, dto] = upsert.mock.calls[0];
    // 분석 결과와 사진 목록은 건드리지 않아야 다시 켰을 때 복원된다
    expect(dto.photoTags).toBeUndefined();
    expect(dto.photoKeys).toBeUndefined();
  });

  it("rejects a photo that is not the user's", async () => {
    const { controller } = makeController({ findByUser: jest.fn().mockResolvedValue(stored) });

    await expect(
      controller.togglePhotoTag(user, {
        key: 'preferences/u1/someone-else.png',
        tag: 'cafe',
        enabled: false,
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects a tag that photo never produced', async () => {
    const { controller } = makeController({ findByUser: jest.fn().mockResolvedValue(stored) });

    await expect(
      controller.togglePhotoTag(user, {
        key: 'preferences/u1/a.png',
        tag: 'hotspring',
        enabled: false,
      }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('PreferenceAnalyzerController.listPhotoTags', () => {
  it('returns per-photo tags with their on/off state', async () => {
    const { controller } = makeController({
      findByUser: jest.fn().mockResolvedValue({
        photoKeys: ['preferences/u1/a.png'],
        photoTags: { 'preferences/u1/a.png': tags({ food: ['cafe'], mood: ['healing'] }) },
        disabledPhotoTags: { 'preferences/u1/a.png': ['healing'] },
      }),
    });

    await expect(controller.listPhotoTags(user)).resolves.toEqual([
      {
        key: 'preferences/u1/a.png',
        // 표시용 URL 은 만료되는 서명 URL 이라 응답마다 새로 만들어 붙인다.
        url: '/storage-private/preferences/u1/a.png?sig=x',
        analyzed: true,
        tags: [
          { tag: 'cafe', enabled: true },
          { tag: 'healing', enabled: false },
        ],
      },
    ]);
  });

  it('returns an empty list when the user has no preferences yet', async () => {
    const { controller } = makeController();
    await expect(controller.listPhotoTags(user)).resolves.toEqual([]);
  });
});

describe('PreferenceAnalyzerController.getJob', () => {
  it('returns the job status', async () => {
    const { controller } = makeController({
      getStatus: jest.fn().mockResolvedValue({ jobId: 'job-1', status: 'running' }),
    });

    await expect(controller.getJob(user, 'job-1')).resolves.toMatchObject({ status: 'running' });
  });

  it('404s for an unknown or foreign job', async () => {
    const { controller } = makeController({ getStatus: jest.fn().mockResolvedValue(null) });

    await expect(controller.getJob(user, 'nope')).rejects.toThrow(NotFoundException);
  });
});
