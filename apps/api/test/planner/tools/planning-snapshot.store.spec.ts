/// <reference types="jest" />
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { PlanningSnapshotStore } from '../../../src/planner/tools/planning-snapshot.store';
import type {
  PlanningSnapshot,
  StoredPlanningCandidate,
} from '../../../src/planner/tools/planning.contract';

// Opt in against an isolated Redis; the ordinary unit suite never needs a running service.
const redisTests = process.env['PLANNING_REDIS_TEST_PORT'] ? describe : describe.skip;

redisTests('PlanningSnapshotStore with real isolated Redis', () => {
  let store: PlanningSnapshotStore;
  let redis: Redis;
  const ids: string[] = [];

  beforeAll(() => {
    const port = Number(process.env['PLANNING_REDIS_TEST_PORT']);
    store = new PlanningSnapshotStore(
      new ConfigService({ REDIS_URL: '', REDIS_HOST: '127.0.0.1', REDIS_PORT: port }),
    );
    redis = new Redis({ host: '127.0.0.1', port, maxRetriesPerRequest: 1 });
  });

  afterAll(async () => {
    for (const id of ids) {
      await redis.del(
        ...['snapshot', 'candidate', 'count', 'running'].map((kind) => `planning:v1:${kind}:${id}`),
      );
    }
    store.onModuleDestroy();
    await redis.quit();
  });

  it('round trips snapshots and candidate drafts with bounded expiry', async () => {
    const snapshotId = randomUUID();
    const candidateId = randomUUID();
    ids.push(snapshotId, candidateId);
    const snapshot = {
      snapshotId,
      ownerId: 'owner',
      snapshotVersion: 'version',
    } as PlanningSnapshot;
    await store.putSnapshot(snapshot);
    expect(await store.getSnapshot(snapshotId)).toEqual(snapshot);
    expect(await redis.ttl(`planning:v1:snapshot:${snapshotId}`)).toBeGreaterThan(890);
    const candidate = {
      ownerId: 'owner',
      snapshotId,
      snapshotVersion: 'version',
      evaluation: { candidateId },
    } as StoredPlanningCandidate;
    await store.putCandidate(candidate, 60);
    expect(await store.getCandidate(candidateId)).toEqual(candidate);
    expect(await redis.ttl(`planning:v1:candidate:${candidateId}`)).toBeLessThanOrEqual(60);
    expect(await store.getSnapshot(randomUUID())).toBeNull();
  });

  it('admits one concurrent computation and only lets its lease owner release it', async () => {
    const id = randomUUID();
    ids.push(id);
    const outcomes = await Promise.all([store.acquire(id, 'first'), store.acquire(id, 'second')]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    const winner = outcomes[0] ? 'first' : 'second';
    await store.release(id, 'wrong-token');
    expect(await store.acquire(id, 'third')).toBe(false);
    await store.release(id, winner);
    expect(await store.acquire(id, 'third')).toBe(true);
  });

  it('atomically limits concurrent candidate writes without leaving an immortal counter', async () => {
    const snapshotId = randomUUID();
    ids.push(snapshotId);
    const candidates = Array.from({ length: 101 }, () => {
      const candidateId = randomUUID();
      ids.push(candidateId);
      return {
        ownerId: 'owner',
        snapshotId,
        snapshotVersion: 'version',
        evaluation: { candidateId },
      } as StoredPlanningCandidate;
    });
    const results = await Promise.allSettled(
      candidates.map((candidate) => store.putCandidate(candidate, 60)),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(100);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await redis.ttl(`planning:v1:count:${snapshotId}`)).toBeGreaterThan(0);
    const saved = await Promise.all(
      candidates.map((candidate) => store.getCandidate(candidate.evaluation.candidateId)),
    );
    expect(saved.filter(Boolean)).toHaveLength(100);
  });
});
