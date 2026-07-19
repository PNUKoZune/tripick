/// <reference types="jest" />

import type { Job } from 'bullmq';
import type { TasteTagDto } from '@tripick/types';
import { PreferenceAnalysisService } from '../../src/preference-analyzer/preference-analysis.service';
import { VisionAnalyzer } from '../../src/preference-analyzer/vision.analyzer';
import type { AnalyzePhotosJobData } from '../../src/preference-analyzer/preference-analyzer.constants';

function tags(partial: Partial<TasteTagDto> = {}): TasteTagDto {
  return { food: [], mood: [], environment: [], confidence: 0, ...partial };
}

function makeService(overrides: {
  analyzeImage?: jest.Mock;
  findByUser?: jest.Mock;
  upsert?: jest.Mock;
  getObject?: jest.Mock;
  sendToUser?: jest.Mock;
  queue?: Partial<{ add: jest.Mock; getJob: jest.Mock }>;
} = {}) {
  // aggregate 는 실제 구현을 쓴다 — 재집계 결과가 이 서비스의 핵심 산출물이라서.
  const visionAnalyzer = new VisionAnalyzer({ get: <T>(_k: string, d?: T) => d } as any);
  visionAnalyzer.analyzeImage = overrides.analyzeImage ?? jest.fn().mockResolvedValue(tags());

  const preferencesService = {
    findByUser: overrides.findByUser ?? jest.fn().mockResolvedValue(null),
    upsert: overrides.upsert ?? jest.fn().mockResolvedValue({}),
  };
  const storage = {
    getObject:
      overrides.getObject ??
      jest.fn().mockResolvedValue({ body: Buffer.from('img'), contentType: 'image/png' }),
  };
  const notifications = { sendToUser: overrides.sendToUser ?? jest.fn().mockResolvedValue(undefined) };
  const queue = { add: jest.fn(), getJob: jest.fn(), ...overrides.queue };

  const service = new PreferenceAnalysisService(
    queue as any,
    visionAnalyzer,
    preferencesService as any,
    storage as any,
    notifications as any,
  );

  return { service, preferencesService, storage, notifications, queue, visionAnalyzer };
}

function makeJob(data: AnalyzePhotosJobData): Job<AnalyzePhotosJobData, any> {
  return {
    id: 'job-1',
    data,
    updateProgress: jest.fn().mockResolvedValue(undefined),
  } as unknown as Job<AnalyzePhotosJobData, any>;
}

describe('PreferenceAnalysisService.runJob', () => {
  it('analyzes only the newly uploaded photos', async () => {
    const analyzeImage = jest.fn().mockResolvedValue(tags({ food: ['cafe'], confidence: 0.8 }));
    const { service, storage } = makeService({
      analyzeImage,
      findByUser: jest.fn().mockResolvedValue({
        photoUrls: ['http://s/old.png', 'http://s/new.png'],
        photoTags: { 'http://s/old.png': tags({ food: ['korean'], confidence: 0.6 }) },
      }),
    });

    await service.runJob(
      makeJob({
        userId: 'u1',
        photoUrls: ['http://s/new.png'],
        storageKeys: ['public/preferences/u1/new.png'],
      }),
    );

    // 기존 사진은 다시 분석하지 않는다 — 장당 30초가 넘기 때문.
    expect(analyzeImage).toHaveBeenCalledTimes(1);
    expect(storage.getObject).toHaveBeenCalledWith('public/preferences/u1/new.png');
  });

  it('re-aggregates taste tags across old and new photo results', async () => {
    const { service, preferencesService } = makeService({
      analyzeImage: jest.fn().mockResolvedValue(tags({ food: ['korean'], confidence: 0.9 })),
      findByUser: jest.fn().mockResolvedValue({
        photoUrls: ['http://s/a.png', 'http://s/b.png', 'http://s/c.png'],
        photoTags: {
          'http://s/a.png': tags({ food: ['korean'], mood: ['healing'], confidence: 0.7 }),
          'http://s/b.png': tags({ food: ['korean'], mood: ['romantic'], confidence: 0.5 }),
        },
      }),
    });

    await service.runJob(
      makeJob({ userId: 'u1', photoUrls: ['http://s/c.png'], storageKeys: ['k/c.png'] }),
    );

    const [, dto] = preferencesService.upsert.mock.calls[0];
    // 3장 중 korean 3회 → 유지, healing·romantic 각 1회 → threshold(2) 미달로 제거
    expect(dto.tasteTags.food).toEqual(['korean']);
    expect(dto.tasteTags.mood).toEqual([]);
    expect(Object.keys(dto.photoTags)).toHaveLength(3);
  });

  it('drops results for photos deleted while the job was running', async () => {
    const { service, preferencesService } = makeService({
      analyzeImage: jest.fn().mockResolvedValue(tags({ food: ['cafe'], confidence: 0.8 })),
      // 분석 도중 사용자가 새 사진을 지워 photoUrls 에서 빠진 상황
      findByUser: jest.fn().mockResolvedValue({
        photoUrls: ['http://s/kept.png'],
        photoTags: { 'http://s/kept.png': tags({ mood: ['healing'], confidence: 0.5 }) },
      }),
    });

    await service.runJob(
      makeJob({ userId: 'u1', photoUrls: ['http://s/gone.png'], storageKeys: ['k/gone.png'] }),
    );

    const [, dto] = preferencesService.upsert.mock.calls[0];
    expect(Object.keys(dto.photoTags)).toEqual(['http://s/kept.png']);
    expect(dto.tasteTags.food).toEqual([]);
  });

  it('reports progress per analyzed photo', async () => {
    const { service } = makeService({
      analyzeImage: jest.fn().mockResolvedValue(tags({ food: ['cafe'], confidence: 0.5 })),
    });
    const job = makeJob({
      userId: 'u1',
      photoUrls: ['http://s/1.png', 'http://s/2.png'],
      storageKeys: ['k/1.png', 'k/2.png'],
    });

    await service.runJob(job);

    expect(job.updateProgress).toHaveBeenNthCalledWith(1, 1);
    expect(job.updateProgress).toHaveBeenNthCalledWith(2, 2);
  });

  it('notifies the user when analysis finishes', async () => {
    const sendToUser = jest.fn().mockResolvedValue(undefined);
    const { service } = makeService({
      analyzeImage: jest.fn().mockResolvedValue(tags({ food: ['cafe'], confidence: 0.8 })),
      findByUser: jest.fn().mockResolvedValue({ photoUrls: ['http://s/1.png'], photoTags: {} }),
      sendToUser,
    });

    await service.runJob(
      makeJob({ userId: 'u1', photoUrls: ['http://s/1.png'], storageKeys: ['k/1.png'] }),
    );

    expect(sendToUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', type: 'general', title: '취향 분석 완료' }),
    );
  });
});

describe('PreferenceAnalysisService.getStatus', () => {
  it('maps bullmq states to job status', async () => {
    const { service } = makeService({
      findByUser: jest.fn().mockResolvedValue({ photoUrls: [], tasteTags: tags() }),
      queue: {
        getJob: jest.fn().mockResolvedValue({
          id: 'job-1',
          data: { userId: 'u1', photoUrls: ['a', 'b'] },
          progress: 1,
          getState: jest.fn().mockResolvedValue('active'),
        }),
      },
    });

    const status = await service.getStatus('job-1', 'u1');

    expect(status).toMatchObject({ status: 'running', analyzed: 1, total: 2 });
  });

  it('returns the final taste tags once completed', async () => {
    const finalTags = tags({ food: ['cafe'], confidence: 0.8 });
    const { service } = makeService({
      findByUser: jest.fn().mockResolvedValue({ photoUrls: ['a'], tasteTags: finalTags }),
      queue: {
        getJob: jest.fn().mockResolvedValue({
          id: 'job-1',
          data: { userId: 'u1', photoUrls: ['a'] },
          progress: 1,
          getState: jest.fn().mockResolvedValue('completed'),
        }),
      },
    });

    const status = await service.getStatus('job-1', 'u1');

    expect(status?.status).toBe('completed');
    expect(status?.tasteTags).toEqual(finalTags);
  });

  it('hides jobs belonging to another user', async () => {
    const { service } = makeService({
      queue: {
        getJob: jest.fn().mockResolvedValue({
          id: 'job-1',
          data: { userId: 'someone-else', photoUrls: ['a'] },
          getState: jest.fn().mockResolvedValue('active'),
        }),
      },
    });

    expect(await service.getStatus('job-1', 'u1')).toBeNull();
  });

  it('returns null when the job has expired', async () => {
    const { service } = makeService({ queue: { getJob: jest.fn().mockResolvedValue(undefined) } });

    expect(await service.getStatus('gone', 'u1')).toBeNull();
  });

  it('surfaces the failure reason', async () => {
    const { service } = makeService({
      findByUser: jest.fn().mockResolvedValue({ photoUrls: [], tasteTags: tags() }),
      queue: {
        getJob: jest.fn().mockResolvedValue({
          id: 'job-1',
          data: { userId: 'u1', photoUrls: ['a'] },
          progress: 0,
          failedReason: 'storage unreachable',
          getState: jest.fn().mockResolvedValue('failed'),
        }),
      },
    });

    const status = await service.getStatus('job-1', 'u1');

    expect(status).toMatchObject({ status: 'failed', error: 'storage unreachable' });
  });
});
