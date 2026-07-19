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
  setPhotoUrls?: jest.Mock;
  isReady?: jest.Mock;
  putObject?: jest.Mock;
  enqueue?: jest.Mock;
  getStatus?: jest.Mock;
  deleteObject?: jest.Mock;
} = {}) {
  const visionAnalyzer = new VisionAnalyzer({ get: <T>(_k: string, d?: T) => d } as any);
  const analysisService = {
    enqueue: overrides.enqueue ?? jest.fn().mockResolvedValue({ jobId: 'job-1', status: 'queued' }),
    getStatus: overrides.getStatus ?? jest.fn().mockResolvedValue(null),
  };
  const preferencesService = {
    findByUser: overrides.findByUser ?? jest.fn().mockResolvedValue(null),
    upsert: overrides.upsert ?? jest.fn().mockResolvedValue({ photoUrls: [], tasteTags: tags() }),
    setPhotoUrls:
      overrides.setPhotoUrls ?? jest.fn().mockResolvedValue({ photoUrls: [], tasteTags: tags() }),
  };
  const storage = {
    isReady: overrides.isReady ?? jest.fn().mockReturnValue(true),
    putObject: overrides.putObject ?? jest.fn(async ({ key }: { key: string }) => `http://s/${key}`),
    deleteObject: overrides.deleteObject ?? jest.fn().mockResolvedValue(undefined),
    keyFromPublicUrl: (url: string) => url.replace('http://s/', ''),
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
    const [, urls] = preferencesService.setPhotoUrls.mock.calls[0];
    expect(urls).toHaveLength(2);
    // 태그가 아직 안 바뀌었으므로 재임베딩을 부르는 upsert 는 타지 않는다.
    expect(preferencesService.upsert).not.toHaveBeenCalled();
    expect(analysisService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', photoUrls: expect.any(Array) }),
      expect.any(Array),
    );
  });

  it('re-queues photos a previous job failed to analyze', async () => {
    const { controller, analysisService } = makeController({
      findByUser: jest.fn().mockResolvedValue({
        photoUrls: ['http://s/done.png', 'http://s/stranded.png'],
        // stranded 는 이전 잡이 재시도까지 실패해 결과가 없다
        photoTags: { 'http://s/done.png': tags({ food: ['cafe'], confidence: 0.8 }) },
      }),
    });

    await controller.uploadImages(user, [file()] as any);

    const [jobData] = analysisService.enqueue.mock.calls[0];
    expect(jobData.photoUrls).toHaveLength(2);
    expect(jobData.photoUrls[0]).toBe('http://s/stranded.png');
    expect(jobData.storageKeys[0]).toBe('stranded.png');
    // 이미 분석된 사진은 다시 태우지 않는다
    expect(jobData.photoUrls).not.toContain('http://s/done.png');
  });

  it('appends to the photos already stored', async () => {
    const { controller, preferencesService } = makeController({
      findByUser: jest.fn().mockResolvedValue({ photoUrls: ['http://s/old.png'] }),
    });

    await controller.uploadImages(user, [file()] as any);

    const [, urls] = preferencesService.setPhotoUrls.mock.calls[0];
    expect(urls[0]).toBe('http://s/old.png');
    expect(urls).toHaveLength(2);
  });

  it('rejects uploads that would exceed the total photo cap', async () => {
    const { controller, storage } = makeController({
      findByUser: jest.fn().mockResolvedValue({
        photoUrls: Array.from({ length: 9 }, (_, i) => `http://s/${i}.png`),
      }),
    });

    await expect(controller.uploadImages(user, [file(), file()] as any)).rejects.toThrow(
      BadRequestException,
    );
    // 한도를 넘으면 스토리지에 아무것도 쓰지 않는다.
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('allows an upload that exactly fills the cap', async () => {
    const { controller } = makeController({
      findByUser: jest.fn().mockResolvedValue({
        photoUrls: Array.from({ length: 8 }, (_, i) => `http://s/${i}.png`),
      }),
    });

    await expect(controller.uploadImages(user, [file(), file()] as any)).resolves.toBeDefined();
  });

  it('refuses when object storage is not configured', async () => {
    const { controller } = makeController({ isReady: jest.fn().mockReturnValue(false) });

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
    expect(storage.putObject).not.toHaveBeenCalled();
  });
});

describe('PreferenceAnalyzerController.deletePhoto', () => {
  it('re-aggregates taste tags from the remaining photos', async () => {
    const upsert = jest.fn().mockResolvedValue({
      photoUrls: ['http://s/b.png'],
      tasteTags: tags({ mood: ['healing'], confidence: 0.5 }),
    });
    const { controller, storage } = makeController({
      findByUser: jest.fn().mockResolvedValue({
        photoUrls: ['http://s/a.png', 'http://s/b.png'],
        photoTags: {
          'http://s/a.png': tags({ food: ['korean'], confidence: 0.9 }),
          'http://s/b.png': tags({ mood: ['healing'], confidence: 0.5 }),
        },
      }),
      upsert,
    });

    await controller.deletePhoto(user, 'http://s/a.png');

    expect(storage.deleteObject).toHaveBeenCalledWith('a.png');
    const [, dto] = upsert.mock.calls[0];
    // 지운 사진의 korean 은 사라지고 남은 사진의 healing 만 남는다.
    expect(dto.photoTags).toEqual({ 'http://s/b.png': tags({ mood: ['healing'], confidence: 0.5 }) });
    expect(dto.tasteTags.food).toEqual([]);
    expect(dto.tasteTags.mood).toEqual(['healing']);
  });

  it('ignores a url that does not belong to the user', async () => {
    const upsert = jest.fn();
    const { controller, storage } = makeController({
      findByUser: jest.fn().mockResolvedValue({ photoUrls: ['http://s/mine.png'], photoTags: {} }),
      upsert,
    });

    await controller.deletePhoto(user, 'http://s/someone-else.png');

    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('requires a url', async () => {
    const { controller } = makeController();
    await expect(controller.deletePhoto(user, undefined)).rejects.toThrow(BadRequestException);
  });
});

describe('PreferenceAnalyzerController.togglePhotoTag', () => {
  const stored = {
    photoUrls: ['http://s/a.png', 'http://s/b.png'],
    photoTags: {
      'http://s/a.png': tags({ food: ['cafe'], mood: ['healing'], confidence: 0.8 }),
      'http://s/b.png': tags({ food: ['cafe'], mood: ['romantic'], confidence: 0.6 }),
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
      url: 'http://s/a.png',
      tag: 'healing',
      enabled: false,
    });

    const [, dto] = upsert.mock.calls[0];
    expect(dto.disabledPhotoTags).toEqual({ 'http://s/a.png': ['healing'] });
    expect(dto.tasteTags.mood).not.toContain('healing');
    // 다른 사진에서도 나온 cafe 는 그대로 남는다
    expect(dto.tasteTags.food).toEqual(['cafe']);
    // 화면이 바로 반영할 수 있게 사진별 상태를 함께 돌려준다
    expect(result.photos[0]).toEqual({
      url: 'http://s/a.png',
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
        .mockResolvedValue({ ...stored, disabledPhotoTags: { 'http://s/a.png': ['cafe'] } }),
      upsert,
    });

    await controller.togglePhotoTag(user, {
      url: 'http://s/a.png',
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
      url: 'http://s/a.png',
      tag: 'cafe',
      enabled: false,
    });

    const [, dto] = upsert.mock.calls[0];
    // 분석 결과와 사진 목록은 건드리지 않아야 다시 켰을 때 복원된다
    expect(dto.photoTags).toBeUndefined();
    expect(dto.photoUrls).toBeUndefined();
  });

  it("rejects a photo that is not the user's", async () => {
    const { controller } = makeController({ findByUser: jest.fn().mockResolvedValue(stored) });

    await expect(
      controller.togglePhotoTag(user, {
        url: 'http://s/someone-else.png',
        tag: 'cafe',
        enabled: false,
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects a tag that photo never produced', async () => {
    const { controller } = makeController({ findByUser: jest.fn().mockResolvedValue(stored) });

    await expect(
      controller.togglePhotoTag(user, {
        url: 'http://s/a.png',
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
        photoUrls: ['http://s/a.png'],
        photoTags: { 'http://s/a.png': tags({ food: ['cafe'], mood: ['healing'] }) },
        disabledPhotoTags: { 'http://s/a.png': ['healing'] },
      }),
    });

    await expect(controller.listPhotoTags(user)).resolves.toEqual([
      {
        url: 'http://s/a.png',
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
