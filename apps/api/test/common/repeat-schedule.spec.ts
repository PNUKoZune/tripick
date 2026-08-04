/// <reference types="jest" />

import type { Queue } from 'bullmq';
import { upsertRepeatSchedules } from '../../src/common/repeat-schedule';

/** getRepeatableJobs 가 돌려주는 항목 1건. 스케줄러 항목은 key 가 곧 이름이다. */
function entry(name: string, key: string, pattern = '*/5 * * * *') {
  return { key, name, pattern, next: 0, endDate: null, tz: 'Asia/Seoul' };
}

function build(existing: ReturnType<typeof entry>[] = []) {
  const queue = {
    upsertJobScheduler: jest.fn(async (_id: string, _repeat: unknown, _template: unknown) => ({
      id: 'job-1',
    })),
    getRepeatableJobs: jest.fn(async () => existing),
    removeRepeatableByKey: jest.fn(async (_key: string) => true),
  };
  return { queue: queue as unknown as Queue, mocks: queue };
}

const SCHEDULES = [{ name: 'scan', cron: '*/5 * * * *' }];

describe('upsertRepeatSchedules', () => {
  beforeEach(() => jest.clearAllMocks());

  it('스케줄러 ID = 잡 이름으로 upsert 한다 — 프로세서가 job.name 으로 분기하므로', async () => {
    const { queue, mocks } = build();

    await upsertRepeatSchedules(queue, SCHEDULES, 1_000);

    expect(mocks.upsertJobScheduler).toHaveBeenCalledWith(
      'scan',
      { pattern: '*/5 * * * *', tz: 'Asia/Seoul' },
      expect.objectContaining({ name: 'scan' }),
    );
  });

  it('cron 은 KST 로 고정한다 — UTC 컨테이너에서 9시간 어긋나지 않게', async () => {
    const { queue, mocks } = build();

    await upsertRepeatSchedules(queue, SCHEDULES, 1_000);

    expect(mocks.upsertJobScheduler.mock.calls[0]?.[1]).toMatchObject({ tz: 'Asia/Seoul' });
  });

  it('같은 이름의 옛 repeatable(해시 키)을 지운다 — 안 지우면 스캔이 두 벌 돈다', async () => {
    const { queue, mocks } = build([
      entry('scan', 'scan'),
      entry('scan', 'a1b2c3', '*/10 * * * *'),
      entry('scan', 'd4e5f6', '*/15 * * * *'),
    ]);

    await upsertRepeatSchedules(queue, SCHEDULES, 1_000);

    expect(mocks.removeRepeatableByKey.mock.calls.map((c) => c[0])).toEqual(['a1b2c3', 'd4e5f6']);
  });

  it('방금 만든 스케줄러 항목(key = 이름)은 지우지 않는다', async () => {
    const { queue, mocks } = build([entry('scan', 'scan')]);

    await upsertRepeatSchedules(queue, SCHEDULES, 1_000);

    expect(mocks.removeRepeatableByKey).not.toHaveBeenCalled();
  });

  it('다른 잡 이름은 건드리지 않는다 — 한 큐에 여러 스케줄이 얹힌다', async () => {
    const { queue, mocks } = build([entry('other-scan', 'a1b2c3')]);

    await upsertRepeatSchedules(queue, SCHEDULES, 1_000);

    expect(mocks.removeRepeatableByKey).not.toHaveBeenCalled();
  });

  it('여러 스케줄을 한 번에 등록한다', async () => {
    const { queue, mocks } = build();

    await upsertRepeatSchedules(
      queue,
      [
        { name: 'reminder', cron: '0 9 * * *' },
        { name: 'archive', cron: '0 4 * * *' },
      ],
      1_000,
    );

    expect(mocks.upsertJobScheduler.mock.calls.map((c) => c[0])).toEqual(['reminder', 'archive']);
  });

  it('정리 실패는 등록을 실패로 만들지 않는다 — 등록은 이미 끝났고 다음 기동에 다시 시도', async () => {
    const { queue, mocks } = build();
    mocks.getRepeatableJobs.mockRejectedValueOnce(new Error('redis down') as never);

    await expect(upsertRepeatSchedules(queue, SCHEDULES, 1_000)).resolves.toBeUndefined();
    expect(mocks.upsertJobScheduler).toHaveBeenCalled();
  });

  it('등록 실패는 그대로 던진다 — 호출부의 백오프 재시도가 받아야 한다', async () => {
    const { queue, mocks } = build();
    mocks.upsertJobScheduler.mockRejectedValueOnce(new Error('redis down') as never);

    await expect(upsertRepeatSchedules(queue, SCHEDULES, 1_000)).rejects.toThrow('redis down');
  });

  it('무응답이면 타임아웃으로 끊는다 — 부팅이 통째로 멈추지 않게', async () => {
    const { queue, mocks } = build();
    mocks.upsertJobScheduler.mockImplementationOnce(() => new Promise(() => {}) as never);

    await expect(upsertRepeatSchedules(queue, SCHEDULES, 30)).rejects.toThrow('반복 잡 등록 응답 없음');
  });
});
