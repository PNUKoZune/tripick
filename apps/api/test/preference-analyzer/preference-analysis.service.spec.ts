/// <reference types="jest" />

import { ServiceUnavailableException } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { TasteTagDto } from '@tripick/types';
import { PreferenceAnalysisService } from '../../src/preference-analyzer/preference-analysis.service';
import { VisionAnalyzer } from '../../src/preference-analyzer/vision.analyzer';
import type { AnalyzePhotosJobData } from '../../src/preference-analyzer/preference-analyzer.constants';

function tags(partial: Partial<TasteTagDto> = {}): TasteTagDto {
  return { food: [], mood: [], environment: [], confidence: 0, ...partial };
}

/** analyzePhoto 목 — 성공 결과를 만든다. */
function ok(partial: Partial<TasteTagDto> = {}) {
  return { tags: tags(partial), ok: true };
}

/** analyzePhoto 목 — vision 호출 자체가 실패한 경우. */
function failed() {
  return { tags: tags(), ok: false };
}

function makeService(overrides: {
  analyzePhoto?: jest.Mock;
  findByUser?: jest.Mock;
  upsert?: jest.Mock;
  getPrivateObject?: jest.Mock;
  signedUrls?: jest.Mock;
  inboxCreate?: jest.Mock;
  queue?: Partial<{ add: jest.Mock; getJob: jest.Mock; getJobs: jest.Mock }>;
} = {}) {
  // aggregate 는 실제 구현을 쓴다 — 재집계 결과가 이 서비스의 핵심 산출물이라서.
  const visionAnalyzer = new VisionAnalyzer({ get: <T>(_k: string, d?: T) => d } as any);
  visionAnalyzer.analyzePhoto = overrides.analyzePhoto ?? jest.fn().mockResolvedValue(ok());

  const preferencesService = {
    findByUser: overrides.findByUser ?? jest.fn().mockResolvedValue(null),
    upsert: overrides.upsert ?? jest.fn().mockResolvedValue({}),
  };
  const storage = {
    getPrivateObject:
      overrides.getPrivateObject ??
      jest.fn().mockResolvedValue({ body: Buffer.from('img'), contentType: 'image/png' }),
    // 표시용 서명 URL. 실제 구현처럼 키 순서를 지켜 같은 길이 배열을 돌려준다 —
    // 길이가 어긋나면 키와 URL 이 잘못 짝지어진다.
    signedUrls:
      overrides.signedUrls ??
      jest.fn(async (keys: string[]) => keys.map((key) => `/storage-private/${key}?sig=x`)),
  };
  // 알림은 InboxService.create 로 발송한다 (구 FCM sendToUser 직접 호출에서 이관).
  const inbox = { create: overrides.inboxCreate ?? jest.fn().mockResolvedValue(undefined) };
  const queue = {
    add: jest.fn(),
    getJob: jest.fn(),
    getJobs: jest.fn().mockResolvedValue([]),
    ...overrides.queue,
  };

  const service = new PreferenceAnalysisService(
    queue as any,
    visionAnalyzer,
    preferencesService as any,
    storage as any,
    inbox as any,
  );

  return { service, preferencesService, storage, inbox, queue, visionAnalyzer };
}

function makeJob(
  data: AnalyzePhotosJobData,
  attemptsMade = 0,
): Job<AnalyzePhotosJobData, any> {
  return {
    id: 'job-1',
    data,
    attemptsMade,
    opts: { attempts: 3 },
    updateProgress: jest.fn().mockResolvedValue(undefined),
  } as unknown as Job<AnalyzePhotosJobData, any>;
}

describe('PreferenceAnalysisService.runJob', () => {
  it('analyzes only the newly uploaded photos', async () => {
    const analyzePhoto = jest.fn().mockResolvedValue(ok({ food: ['cafe'], confidence: 0.8 }));
    const { service, storage } = makeService({
      analyzePhoto,
      findByUser: jest.fn().mockResolvedValue({
        photoKeys: ['preferences/u1/old.png', 'preferences/u1/new.png'],
        photoTags: { 'preferences/u1/old.png': tags({ food: ['korean'], confidence: 0.6 }) },
      }),
    });

    await service.runJob(
      makeJob({
        userId: 'u1',
        photoKeys: ['preferences/u1/new.png'],
      }),
    );

    // 기존 사진은 다시 분석하지 않는다 — 장당 30초가 넘기 때문.
    expect(analyzePhoto).toHaveBeenCalledTimes(1);
    expect(storage.getPrivateObject).toHaveBeenCalledWith('preferences/u1/new.png');
  });

  it('re-aggregates taste tags across old and new photo results', async () => {
    const { service, preferencesService } = makeService({
      analyzePhoto: jest.fn().mockResolvedValue(ok({ food: ['korean'], confidence: 0.9 })),
      findByUser: jest.fn().mockResolvedValue({
        photoKeys: ['preferences/u1/a.png', 'preferences/u1/b.png', 'preferences/u1/c.png'],
        photoTags: {
          'preferences/u1/a.png': tags({ food: ['korean'], mood: ['healing'], confidence: 0.7 }),
          'preferences/u1/b.png': tags({ food: ['korean'], mood: ['romantic'], confidence: 0.5 }),
        },
      }),
    });

    await service.runJob(
      makeJob({ userId: 'u1', photoKeys: ['preferences/u1/c.png'] }),
    );

    const [, dto] = preferencesService.upsert.mock.calls[0];
    // 3장 중 korean 3회 → 유지, healing·romantic 각 1회 → threshold(2) 미달로 제거
    expect(dto.tasteTags.food).toEqual(['korean']);
    expect(dto.tasteTags.mood).toEqual([]);
    expect(Object.keys(dto.photoTags)).toHaveLength(3);
  });

  it('drops results for photos deleted while the job was running', async () => {
    const { service, preferencesService } = makeService({
      analyzePhoto: jest.fn().mockResolvedValue(ok({ food: ['cafe'], confidence: 0.8 })),
      // 분석 도중 사용자가 새 사진을 지워 photoUrls 에서 빠진 상황
      findByUser: jest.fn().mockResolvedValue({
        photoKeys: ['preferences/u1/kept.png'],
        photoTags: { 'preferences/u1/kept.png': tags({ mood: ['healing'], confidence: 0.5 }) },
      }),
    });

    await service.runJob(
      makeJob({ userId: 'u1', photoKeys: ['preferences/u1/gone.png'] }),
    );

    const [, dto] = preferencesService.upsert.mock.calls[0];
    expect(Object.keys(dto.photoTags)).toEqual(['preferences/u1/kept.png']);
    expect(dto.tasteTags.food).toEqual([]);
  });

  it('reports progress per analyzed photo', async () => {
    const { service } = makeService({
      analyzePhoto: jest.fn().mockResolvedValue(ok({ food: ['cafe'], confidence: 0.5 })),
    });
    const job = makeJob({
      userId: 'u1',
      photoKeys: ['preferences/u1/1.png', 'preferences/u1/2.png'],
    });

    await service.runJob(job);

    // 첫 호출은 시작 시점의 기저(이미 분석된 장수 = 0), 이후 장마다 1씩
    expect(job.updateProgress).toHaveBeenNthCalledWith(1, 0);
    expect(job.updateProgress).toHaveBeenNthCalledWith(2, 1);
    expect(job.updateProgress).toHaveBeenNthCalledWith(3, 2);
  });

  it('does not record a failed analysis as an empty result', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const { service } = makeService({
      // 1장은 성공, 1장은 vision 호출 실패
      analyzePhoto: jest
        .fn()
        .mockResolvedValueOnce(ok({ food: ['cafe'], confidence: 0.8 }))
        .mockResolvedValueOnce(failed()),
      findByUser: jest
        .fn()
        .mockResolvedValue({ photoKeys: ['preferences/u1/1.png', 'preferences/u1/2.png'], photoTags: {} }),
      upsert,
    });

    await expect(
      service.runJob(
        makeJob({
          userId: 'u1',
          photoKeys: ['preferences/u1/1.png', 'preferences/u1/2.png'],
        }),
      ),
    ).rejects.toThrow(/분석 실패/);

    // 성공분은 저장하되 실패한 사진은 photoTags 에 넣지 않는다 —
    // 빈 결과로 남으면 다음 잡이 건너뛰어 영영 무신호가 된다.
    const [, dto] = upsert.mock.calls[0];
    expect(Object.keys(dto.photoTags)).toEqual(['preferences/u1/1.png']);
  });

  it('skips photos already analyzed by a previous attempt', async () => {
    const analyzePhoto = jest.fn().mockResolvedValue(ok({ food: ['cafe'], confidence: 0.8 }));
    const { service } = makeService({
      analyzePhoto,
      // 1번은 이전 시도에서 이미 분석됨
      findByUser: jest.fn().mockResolvedValue({
        photoKeys: ['preferences/u1/1.png', 'preferences/u1/2.png'],
        photoTags: { 'preferences/u1/1.png': tags({ food: ['korean'], confidence: 0.7 }) },
      }),
    });

    await service.runJob(
      makeJob(
        {
          userId: 'u1',
          photoKeys: ['preferences/u1/1.png', 'preferences/u1/2.png'],
        },
        1,
      ),
    );

    // 재시도가 처음부터 다시 분석하지 않는다
    expect(analyzePhoto).toHaveBeenCalledTimes(1);
  });

  it('notifies only on the final failed attempt', async () => {
    const inboxCreate = jest.fn().mockResolvedValue(undefined);
    const build = (attemptsMade: number) =>
      makeService({
        analyzePhoto: jest.fn().mockResolvedValue(failed()),
        findByUser: jest.fn().mockResolvedValue({ photoKeys: ['preferences/u1/1.png'], photoTags: {} }),
        inboxCreate,
      }).service.runJob(
        makeJob(
          { userId: 'u1', photoKeys: ['preferences/u1/1.png'] },
          attemptsMade,
        ),
      );

    // 중간 재시도에서는 조용히 다시 던지기만 한다
    await expect(build(0)).rejects.toThrow();
    expect(inboxCreate).not.toHaveBeenCalled();

    await expect(build(2)).rejects.toThrow();
    expect(inboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'general', title: '취향 분석 실패' }),
    );
  });

  it('notifies the user when analysis finishes', async () => {
    const inboxCreate = jest.fn().mockResolvedValue(undefined);
    const { service } = makeService({
      analyzePhoto: jest.fn().mockResolvedValue(ok({ food: ['cafe'], confidence: 0.8 })),
      findByUser: jest.fn().mockResolvedValue({ photoKeys: ['preferences/u1/1.png'], photoTags: {} }),
      inboxCreate,
    });

    await service.runJob(
      makeJob({ userId: 'u1', photoKeys: ['preferences/u1/1.png'] }),
    );

    expect(inboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', category: 'general', title: '취향 분석 완료' }),
    );
  });
});

describe('PreferenceAnalysisService.enqueue', () => {
  it('returns a queued job descriptor', async () => {
    const { service } = makeService({
      queue: { add: jest.fn().mockResolvedValue({ id: 7 }) },
    });

    const result = await service.enqueue(
      { userId: 'u1', photoKeys: ['preferences/u1/a', 'preferences/u1/b'] },
      ['old', 'a', 'b'],
    );

    expect(result).toMatchObject({ jobId: '7', status: 'queued', analyzed: 0, total: 2 });
  });

  it('leaves retry policy to the global defaultJobOptions', async () => {
    const add = jest.fn().mockResolvedValue({ id: 1 });
    const { service } = makeService({ queue: { add } });

    await service.enqueue({ userId: 'u1', photoKeys: ['preferences/u1/a'] }, ['a']);

    const [, , opts] = add.mock.calls[0];
    expect(opts).not.toHaveProperty('attempts');
    expect(opts).not.toHaveProperty('backoff');
  });

  it('fails fast instead of hanging when Redis never answers', async () => {
    // Redis 가 죽으면 queue.add 는 던지지도 끝나지도 않는다 (ioredis 오프라인 큐 버퍼링).
    const { service } = makeService({
      queue: { add: jest.fn().mockReturnValue(new Promise(() => {})) },
    });

    await expect(
      service.enqueue({ userId: 'u1', photoKeys: ['preferences/u1/a'] }, ['a']),
    ).rejects.toThrow(ServiceUnavailableException);
  }, 15000);
});

describe('PreferenceAnalysisService.getStatus', () => {
  it('maps bullmq states to job status', async () => {
    const { service } = makeService({
      findByUser: jest.fn().mockResolvedValue({ photoKeys: [], tasteTags: tags() }),
      queue: {
        getJob: jest.fn().mockResolvedValue({
          id: 'job-1',
          data: { userId: 'u1', photoKeys: ['a', 'b'] },
          progress: 1,
          getState: jest.fn().mockResolvedValue('active'),
        }),
      },
    });

    const status = await service.getStatus('job-1', 'u1');

    expect(status).toMatchObject({ status: 'running', analyzed: 1, total: 2 });
  });

  it('does not read preferences while the job is still running', async () => {
    const findByUser = jest.fn();
    const { service } = makeService({
      findByUser,
      queue: {
        getJob: jest.fn().mockResolvedValue({
          id: 'job-1',
          data: { userId: 'u1', photoKeys: ['a'] },
          progress: 0,
          getState: jest.fn().mockResolvedValue('active'),
        }),
      },
    });

    await service.getStatus('job-1', 'u1');

    // 3초마다 폴링하므로 진행 중 DB 조회는 잡당 수십 번의 헛일이 된다.
    expect(findByUser).not.toHaveBeenCalled();
  });

  it('returns the final taste tags once completed', async () => {
    const finalTags = tags({ food: ['cafe'], confidence: 0.8 });
    const { service } = makeService({
      findByUser: jest.fn().mockResolvedValue({ photoKeys: ['a'], tasteTags: finalTags }),
      queue: {
        getJob: jest.fn().mockResolvedValue({
          id: 'job-1',
          data: { userId: 'u1', photoKeys: ['a'] },
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
          data: { userId: 'someone-else', photoKeys: ['a'] },
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
      findByUser: jest.fn().mockResolvedValue({ photoKeys: [], tasteTags: tags() }),
      queue: {
        getJob: jest.fn().mockResolvedValue({
          id: 'job-1',
          data: { userId: 'u1', photoKeys: ['a'] },
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

describe('PreferenceAnalysisService.findActiveJob', () => {
  function pendingJob(userId: string, id = 'job-live') {
    return {
      id,
      data: { userId, photoKeys: ['a', 'b'] },
      progress: 1,
      getState: jest.fn().mockResolvedValue('active'),
    };
  }

  it('finds the job still running for this user', async () => {
    const getJobs = jest.fn().mockResolvedValue([pendingJob('u1')]);
    const { service } = makeService({ queue: { getJobs } });

    await expect(service.findActiveJob('u1')).resolves.toMatchObject({
      jobId: 'job-live',
      status: 'running',
      analyzed: 1,
      total: 2,
    });
    // 끝난 잡은 재분석을 막을 이유가 없다 — 미완료 상태만 본다.
    expect(getJobs).toHaveBeenCalledWith(['active', 'waiting', 'waiting-children', 'delayed']);
  });

  it('ignores jobs belonging to another user', async () => {
    const { service } = makeService({
      queue: { getJobs: jest.fn().mockResolvedValue([pendingJob('someone-else')]) },
    });

    expect(await service.findActiveJob('u1')).toBeNull();
  });

  it('returns null when nothing is in flight', async () => {
    const { service } = makeService();
    expect(await service.findActiveJob('u1')).toBeNull();
  });

  it('treats an unreachable queue as "nothing in flight"', async () => {
    const { service } = makeService({
      queue: { getJobs: jest.fn().mockRejectedValue(new Error('redis down')) },
    });

    // 조회 실패로 요청을 죽이지 않는다 — 뒤이은 enqueue 가 503 을 낸다.
    expect(await service.findActiveJob('u1')).toBeNull();
  });
});
