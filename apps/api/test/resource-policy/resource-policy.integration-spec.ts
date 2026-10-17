import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createServer, type AddressInfo } from 'node:net';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Queue } from 'bullmq';
import { DataSource, IsNull, type EntityManager } from 'typeorm';
import { UserEntity } from '../../src/users/user.entity';
import { TripEntity } from '../../src/trips/trip.entity';
import { GenerationLedgerService } from '../../src/trip-generation/generation-ledger.service';
import { GenerationRequestEntity } from '../../src/trip-generation/generation-request.entity';
import { GenerationNotRunnableError } from '../../src/trip-generation/generation-errors';
import { InferenceResourceEntity } from '../../src/inference-resource/inference-resource.entity';
import { InferenceModelExecutionEntity } from '../../src/inference-resource/inference-model-execution.entity';
import { InferenceResourceService } from '../../src/inference-resource/inference-resource.service';
import type { ReconciliationEvidence } from '../../src/inference-resource/inference-resource.service';
import { runWithInferenceExecutionContext } from '../../src/inference-resource/inference-execution-context';
import { InferenceResourceGate1792300001000 } from '../../src/database/migrations/1792300001000-InferenceResourceGate';
import { GenerationRequestLedger1792250000000 } from '../../src/database/migrations/1792250000000-GenerationRequestLedger';

const SCHEMA = 'resource_policy_integration';
const MIGRATION_SCHEMA = 'resource_policy_migration_integration';
const databaseUrl = process.env.RESOURCE_TEST_DATABASE_URL;
const redisPort = Number(process.env.RESOURCE_TEST_REDIS_PORT);
if (!databaseUrl || !Number.isInteger(redisPort) || redisPort < 1 || redisPort > 65535) {
  throw new Error(
    'Use scripts/test-resource-integration.cjs with explicit disposable PostgreSQL and Redis endpoints',
  );
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function eventually(assertion: () => Promise<void>, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      await assertion();
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
  }
}

describe('Resource admission and model ownership (real PostgreSQL/Redis, stub model)', () => {
  let db: DataSource;
  let ledger: GenerationLedgerService;
  let gate: InferenceResourceService;
  let queue: Queue;
  const queueName = `resource-policy-integration-${process.pid}-${randomUUID()}`;

  beforeAll(async () => {
    const bootstrap = new DataSource({ type: 'postgres', url: databaseUrl });
    await bootstrap.initialize();
    try {
      await bootstrap.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
      await bootstrap.query(`CREATE SCHEMA ${SCHEMA}`);
      await bootstrap.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public');
    } finally {
      await bootstrap.destroy();
    }
    db = new DataSource({
      type: 'postgres',
      url: databaseUrl,
      schema: SCHEMA,
      extra: { options: `-c search_path=${SCHEMA},public`, max: 30 },
      entities: [
        UserEntity,
        TripEntity,
        GenerationRequestEntity,
        InferenceResourceEntity,
        InferenceModelExecutionEntity,
      ],
      synchronize: true,
    });
    await db.initialize();
    ledger = new GenerationLedgerService(db);
    gate = new InferenceResourceService(
      db,
      new ConfigService({
        LLM_CHAT_RESOURCE_KEY: 'integration:shared',
        LLM_CHAT_RESOURCE_DEVICE: 'cpu',
        LLM_VISION_RESOURCE_KEY: 'integration:shared',
        LLM_VISION_RESOURCE_DEVICE: 'cpu',
        LLM_EMBEDDING_RESOURCE_KEY: 'integration:embedding',
        LLM_EMBEDDING_RESOURCE_DEVICE: 'cpu',
        INFERENCE_RESOURCE_POLL_MS: 10,
        INFERENCE_RESOURCE_HEARTBEAT_MS: 500,
        INFERENCE_RESOURCE_STALE_AFTER_MS: 1500,
        INFERENCE_RESOURCE_WAIT_TIMEOUT_MS: 5000,
      }),
    );
    queue = new Queue(queueName, {
      connection: { host: '127.0.0.1', port: redisPort },
      prefix: 'resource-integration',
    });
    await queue.waitUntilReady();
  });

  beforeEach(async () => {
    await db.query(
      'TRUNCATE generation_requests, trips, users, inference_model_executions, inference_resources RESTART IDENTITY CASCADE',
    );
    await queue.obliterate({ force: true });
  });

  afterAll(async () => {
    try {
      if (gate) await gate.onModuleDestroy();
      if (queue)
        try {
          await queue.obliterate({ force: true });
        } finally {
          await queue.close();
        }
    } finally {
      if (db?.isInitialized)
        try {
          await db.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
        } finally {
          await db.destroy();
        }
    }
  });

  async function user(): Promise<string> {
    return (await db.getRepository(UserEntity).save({ nickname: `integration-${randomUUID()}` }))
      .id;
  }
  function createTrip(userId: string) {
    return async (manager: EntityManager): Promise<TripEntity> =>
      manager.getRepository(TripEntity).save({
        userId,
        title: 'Policy integration fixture',
        destination: '서울',
        startDate: '2026-10-18',
        endDate: '2026-10-18',
        status: 'generating',
        transportMode: 'transit',
      });
  }
  async function admit(
    userId?: string,
    key: string = randomUUID(),
    input: unknown = { destination: '서울' },
  ) {
    const id = userId ?? (await user());
    return ledger.admit(id, key, input, createTrip(id));
  }
  function job(row: GenerationRequestEntity) {
    return { tripId: row.tripId, userId: row.userId, generationId: row.id };
  }

  it('admits exactly one unfinished request per user under concurrent submissions', async () => {
    const id = await user();
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => admit(id)));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    for (const result of results)
      if (result.status === 'rejected') {
        expect(result.reason.getStatus()).toBe(429);
        expect(result.reason.getResponse()).toMatchObject({
          code: 'USER_GENERATION_LIMIT',
          retryAfter: 30,
        });
      }
    expect(await db.getRepository(TripEntity).count()).toBe(1);
    expect(await db.getRepository(GenerationRequestEntity).count()).toBe(1);
  });

  it('replays concurrent identical keys without creating additional trips', async () => {
    const id = await user();
    const results = await Promise.all(Array.from({ length: 12 }, () => admit(id, 'same-key')));
    expect(new Set(results.map((result) => result.trip.id)).size).toBe(1);
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    expect(await db.getRepository(TripEntity).count()).toBe(1);
  });

  it('rejects a key reused with different input and accepts canonical object key order', async () => {
    const id = await user();
    await admit(id, 'key', { destination: '서울', days: 1 });
    await expect(admit(id, 'key', { days: 1, destination: '서울' })).resolves.toMatchObject({
      replayed: true,
    });
    await expect(admit(id, 'key', { destination: '부산', days: 1 })).rejects.toMatchObject({
      status: 409,
    });
    expect(await db.getRepository(TripEntity).count()).toBe(1);
  });

  it('enforces the global 20-waiter cap atomically and frees queued cancellation capacity', async () => {
    const ids = await Promise.all(Array.from({ length: 26 }, () => user()));
    const results = await Promise.allSettled(ids.map((id) => admit(id)));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(20);
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected).toHaveLength(6);
    for (const result of rejected)
      expect(result.reason.getResponse()).toMatchObject({ code: 'GENERATION_QUEUE_FULL' });
    const accepted = results.find(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof admit>>> =>
        result.status === 'fulfilled',
    )!.value;
    await ledger.cancel(accepted.trip.id, accepted.request.userId);
    await expect(admit()).resolves.toMatchObject({ replayed: false });
    expect(await db.getRepository(GenerationRequestEntity).countBy({ state: 'queued' })).toBe(20);
  });

  it('publishes FIFO to real Redis and persists no acknowledgement for a failed oldest delivery', async () => {
    const accepted = [];
    for (let i = 0; i < 4; i++) accepted.push(await admit());
    const delivered: string[] = [];
    let failures = 1;
    const publish = async (row: GenerationRequestEntity): Promise<boolean> => {
      if (failures-- > 0) return false;
      await queue.add('policy-stub', job(row), { jobId: row.id });
      delivered.push(row.id);
      return true;
    };
    await ledger.publishPending(publish);
    expect(await queue.getWaitingCount()).toBe(0);
    expect(await db.getRepository(GenerationRequestEntity).countBy({ publishedAt: IsNull() })).toBe(
      4,
    );
    await ledger.publishPending(publish);
    expect(delivered).toEqual(accepted.map((entry) => entry.request.id));
    expect(await queue.getWaitingCount()).toBe(4);
    const rows = await db.getRepository(GenerationRequestEntity).find();
    expect(rows.every((row) => row.publishedAt instanceof Date)).toBe(true);
  });

  it('recovers committed admission after Redis failure and deduplicates a lost publish acknowledgement', async () => {
    const accepted = await admit();
    await expect(
      ledger.publishPending(async () => {
        throw new Error('simulated Redis outage');
      }),
    ).rejects.toThrow('Redis outage');
    expect((await ledger.latest(accepted.trip.id))?.publishedAt).toBeNull();
    expect(await db.getRepository(TripEntity).count()).toBe(1);
    await expect(
      ledger.publishPending(async (row) => {
        await queue.add('policy-stub', job(row), { jobId: row.id });
        throw new Error('simulated DB acknowledgement loss');
      }),
    ).rejects.toThrow('acknowledgement loss');
    expect((await ledger.latest(accepted.trip.id))?.publishedAt).toBeNull();
    await ledger.publishPending(async (row) => {
      await queue.add('policy-stub', job(row), { jobId: row.id });
      return true;
    });
    expect(await queue.getWaitingCount()).toBe(1);
    expect((await ledger.latest(accepted.trip.id))?.publishedAt).toBeInstanceOf(Date);
  });

  it('fences a late result after cancellation and retains the user slot until worker unwind', async () => {
    const accepted = await admit();
    const execution = (await ledger.claim(job(accepted.request)))!;
    expect(execution).toBeTruthy();
    await ledger.cancel(accepted.trip.id, accepted.request.userId);
    await expect(admit(accepted.request.userId)).rejects.toMatchObject({ status: 429 });
    const writer = jest.fn(async (manager: EntityManager) =>
      manager
        .getRepository(TripEntity)
        .update(accepted.trip.id, { title: 'Late write must never run' }),
    );
    await expect(ledger.commit(execution, writer)).rejects.toBeInstanceOf(
      GenerationNotRunnableError,
    );
    expect(writer).not.toHaveBeenCalled();
    await ledger.fail(execution, new Error('cancelled'), true);
    expect((await ledger.latest(accepted.trip.id))?.state).toBe('cancelled');
    expect(
      (await db.getRepository(TripEntity).findOneByOrFail({ id: accepted.trip.id })).title,
    ).toBe('Policy integration fixture');
    await expect(admit(accepted.request.userId)).resolves.toBeDefined();
  });

  it('restores a previously acknowledged queued delivery lost from Redis', async () => {
    const accepted = await admit();
    const publish = async (row: GenerationRequestEntity): Promise<boolean> => {
      await queue.add('policy-stub', job(row), { jobId: row.id });
      return true;
    };
    await ledger.publishPending(publish);
    const publishedAt = (await ledger.latest(accepted.trip.id))!.publishedAt;
    expect(publishedAt).toBeInstanceOf(Date);
    await (await queue.getJob(accepted.request.id))!.remove();
    expect(await queue.getWaitingCount()).toBe(0);
    await ledger.publishPending(publish);
    expect(await queue.getWaitingCount()).toBe(1);
    expect((await ledger.latest(accepted.trip.id))!.publishedAt).toEqual(publishedAt);
  });

  it('commits the current execution once and rolls back a failed result transaction', async () => {
    const accepted = await admit();
    const execution = (await ledger.claim(job(accepted.request)))!;
    await expect(
      ledger.commit(execution, async (manager) => {
        await manager.getRepository(TripEntity).update(accepted.trip.id, { title: 'rolled back' });
        throw new Error('result transaction failed');
      }),
    ).rejects.toThrow('result transaction failed');
    expect((await ledger.latest(accepted.trip.id))?.state).toBe('running');
    expect(
      (await db.getRepository(TripEntity).findOneByOrFail({ id: accepted.trip.id })).title,
    ).toBe('Policy integration fixture');
    await expect(
      ledger.commit(execution, async (manager) => {
        await manager.getRepository(TripEntity).update(accepted.trip.id, { title: 'committed' });
        return 'result';
      }),
    ).resolves.toBe('result');
    expect((await ledger.latest(accepted.trip.id))?.state).toBe('succeeded');
    expect(
      await db.getRepository(TripEntity).findOneByOrFail({ id: accepted.trip.id }),
    ).toMatchObject({ title: 'committed', status: 'confirmed' });
    await expect(ledger.commit(execution, async () => 'duplicate result')).rejects.toBeInstanceOf(
      GenerationNotRunnableError,
    );
    await expect(admit(accepted.request.userId)).resolves.toBeDefined();
  });

  it('enforces the database attempt budget after fresh Redis deliveries reset attemptsMade', async () => {
    const accepted = await admit();
    for (let attempt = 1; attempt <= 3; attempt++) {
      await ledger.publishPending(async (row) => {
        await queue.add('policy-stub', job(row), { jobId: row.id });
        return true;
      });
      const delivery = (await queue.getJob(accepted.request.id))!;
      expect(delivery.attemptsMade).toBe(0);
      const execution = (await ledger.claim(delivery.data))!;
      expect(execution).toBeTruthy();
      expect((await ledger.latest(accepted.trip.id))?.attempt).toBe(attempt);
      await ledger.fail(execution, new Error('retryable model failure'), false);
      await delivery.remove();
    }
    expect(await ledger.latest(accepted.trip.id)).toMatchObject({
      state: 'failed',
      attempt: 3,
      maxAttempts: 3,
    });
    await expect(ledger.claim(job(accepted.request))).resolves.toBeNull();
    expect(
      await db.getRepository(TripEntity).findOneByOrFail({ id: accepted.trip.id }),
    ).toMatchObject({ status: 'generation_failed' });
    await expect(admit(accepted.request.userId)).resolves.toBeDefined();
  });

  it('quarantines a duplicate worker claim and blocks other work until evidence reconciliation', async () => {
    const first = await admit();
    const second = await admit();
    const execution = (await ledger.claim(job(first.request)))!;
    await expect(ledger.claim(job(first.request))).resolves.toBeNull();
    expect((await ledger.latest(first.trip.id))?.state).toBe('reconciling');
    await expect(ledger.commit(execution, async () => 'unsafe')).rejects.toBeInstanceOf(
      GenerationNotRunnableError,
    );
    await expect(ledger.claim(job(second.request))).resolves.toBeNull();
    expect((await ledger.latest(second.trip.id))?.state).toBe('queued');
    expect((await ledger.latest(second.trip.id))?.publishedAt).toBeNull();
    await expect(ledger.reconcile(first.request.id, 'too short')).rejects.toMatchObject({
      status: 400,
    });
    await ledger.reconcile(first.request.id, 'Integration operator confirmed model server stopped');
    expect((await ledger.latest(first.trip.id))?.reconciliationEvidence).toContain(
      'confirmed model server stopped',
    );
    await expect(ledger.claim(job(second.request))).resolves.toMatchObject({
      id: second.request.id,
    });
  });

  it('quarantines a running execution whose Redis delivery disappeared and fences its late commit', async () => {
    const accepted = await admit();
    await ledger.publishPending(async (row) => {
      await queue.add('policy-stub', job(row), { jobId: row.id });
      return true;
    });
    const execution = (await ledger.claim(job(accepted.request)))!;
    await (await queue.getJob(accepted.request.id))!.remove();
    expect(await queue.getWaitingCount()).toBe(0);
    expect((await ledger.latest(accepted.trip.id))?.state).toBe('running');
    await expect(ledger.quarantine(accepted.request.id, 'too short')).rejects.toMatchObject({
      status: 400,
    });
    const observation = 'integration incident: executor stopped and Redis delivery absent';
    await ledger.quarantine(accepted.request.id, observation);
    const quarantined = (await ledger.latest(accepted.trip.id))!;
    expect(quarantined).toMatchObject({
      state: 'reconciling',
      version: execution.version + 1,
      finishedAt: null,
    });
    expect(quarantined.reconciliationEvidence).toContain(observation);
    await ledger.quarantine(
      accepted.request.id,
      'repeated incident observation for idempotent quarantine',
    );
    expect((await ledger.latest(accepted.trip.id))?.version).toBe(quarantined.version);
    const lateWrite = jest.fn(async () => 'unsafe late result');
    await expect(ledger.commit(execution, lateWrite)).rejects.toBeInstanceOf(
      GenerationNotRunnableError,
    );
    expect(lateWrite).not.toHaveBeenCalled();
    await expect(admit(accepted.request.userId)).rejects.toMatchObject({ status: 429 });
    await ledger.reconcile(
      accepted.request.id,
      'integration operator verified executor stopped and remote model completed',
    );
    const reconciled = (await ledger.latest(accepted.trip.id))!;
    expect(reconciled.state).toBe('failed');
    expect(reconciled.reconciliationEvidence).toContain(observation);
    expect(reconciled.reconciliationEvidence).toContain('remote model completed');
    await expect(admit(accepted.request.userId)).resolves.toBeDefined();
  });

  it('executes chat and vision sharing a resource at maximum concurrency one across service instances', async () => {
    const secondGate = new InferenceResourceService(
      db,
      new ConfigService({
        LLM_CHAT_RESOURCE_KEY: 'integration:shared',
        LLM_CHAT_RESOURCE_DEVICE: 'cpu',
        LLM_VISION_RESOURCE_KEY: 'integration:shared',
        LLM_VISION_RESOURCE_DEVICE: 'cpu',
        INFERENCE_RESOURCE_POLL_MS: 10,
      }),
    );
    let active = 0;
    let peak = 0;
    const calls = Array.from({ length: 8 }, (_, index) =>
      (index % 2 ? gate : secondGate).execute(index % 2 ? 'chat' : 'vision', async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active--;
        return index;
      }),
    );
    expect(await Promise.all(calls)).toHaveLength(8);
    expect(peak).toBe(1);
    expect(
      await db.getRepository(InferenceModelExecutionEntity).countBy({ status: 'SUCCEEDED' }),
    ).toBe(8);
    const executions = await db.getRepository(InferenceModelExecutionEntity).find();
    for (const execution of executions)
      expect(execution.evidence).toMatchObject({
        executor: {
          instanceId: expect.any(String),
          hostname: expect.any(String),
          pid: process.pid,
        },
      });
    expect(
      new Set(
        executions.map(
          (execution) => (execution.evidence.executor as { instanceId: string }).instanceId,
        ),
      ).size,
    ).toBe(2);
    expect(
      await db
        .getRepository(InferenceResourceEntity)
        .findOneByOrFail({ resourceKey: 'integration:shared' }),
    ).toMatchObject({ status: 'READY', activeExecutionId: null });
  });

  it('uses distinct configured resources concurrently without forcing embedding behind chat', async () => {
    const release = deferred();
    const started = deferred();
    const chat = gate.execute('chat', async () => {
      started.resolve();
      await release.promise;
      return 'chat';
    });
    await started.promise;
    try {
      await expect(gate.execute('embedding', async () => 'embedding')).resolves.toBe('embedding');
    } finally {
      release.resolve();
      await chat;
    }
  });

  it('rejects a cancelled ledger execution waiting for a model slot before any HTTP dispatch', async () => {
    const release = deferred();
    const started = deferred();
    const active = gate.execute('chat', async () => {
      started.resolve();
      await release.promise;
      return 'active';
    });
    await started.promise;
    const accepted = await admit();
    const execution = (await ledger.claim(job(accepted.request)))!;
    const operation = jest.fn(async () => 'cancelled HTTP must never start');
    const waiting = runWithInferenceExecutionContext(
      {
        requestId: execution.id,
        attempt: 1,
        assertRunnable: () => ledger.assertRunnable(execution),
      },
      () => gate.execute('vision', operation),
    ).catch((error: unknown) => error);
    try {
      await eventually(async () =>
        expect(
          await db
            .getRepository(InferenceModelExecutionEntity)
            .countBy({ requestId: execution.id, status: 'WAITING' }),
        ).toBe(1),
      );
      await ledger.cancel(accepted.trip.id, accepted.request.userId);
      expect(await waiting).toBeInstanceOf(GenerationNotRunnableError);
      expect(operation).not.toHaveBeenCalled();
      expect(
        await db
          .getRepository(InferenceModelExecutionEntity)
          .findOneByOrFail({ requestId: execution.id }),
      ).toMatchObject({
        status: 'EXPIRED',
        attempt: 1,
        evidence: { reason: 'execution-guard-rejected-before-dispatch' },
      });
    } finally {
      release.resolve();
      await active;
    }
  });

  it('expires bounded model waiters without releasing a healthy current owner', async () => {
    const boundedGate = new InferenceResourceService(
      db,
      new ConfigService({
        LLM_CHAT_RESOURCE_KEY: 'integration:shared',
        LLM_CHAT_RESOURCE_DEVICE: 'cpu',
        INFERENCE_RESOURCE_MAX_WAITING: 1,
        INFERENCE_RESOURCE_WAIT_TIMEOUT_MS: 80,
        INFERENCE_RESOURCE_POLL_MS: 5,
      }),
    );
    const release = deferred();
    const started = deferred();
    const active = gate.execute('chat', async () => {
      started.resolve();
      await release.promise;
      return 'active';
    });
    await started.promise;
    const operation = jest.fn(async () => 'expired HTTP must never start');
    const waiting = boundedGate.execute('chat', operation).catch((error: unknown) => error);
    try {
      await eventually(async () =>
        expect(
          await db.getRepository(InferenceModelExecutionEntity).countBy({ status: 'WAITING' }),
        ).toBe(1),
      );
      await expect(boundedGate.execute('chat', operation)).rejects.toMatchObject({
        code: 'RESOURCE_QUEUE_FULL',
      });
      expect(await waiting).toMatchObject({ code: 'RESOURCE_WAIT_TIMEOUT' });
      expect(operation).not.toHaveBeenCalled();
      expect(
        await db
          .getRepository(InferenceResourceEntity)
          .findOneByOrFail({ resourceKey: 'integration:shared' }),
      ).toMatchObject({ status: 'RUNNING' });
      expect(
        await db.getRepository(InferenceModelExecutionEntity).countBy({ status: 'EXPIRED' }),
      ).toBe(1);
    } finally {
      release.resolve();
      await active;
    }
  });

  it('rechecks database ownership after the last execution guard before model dispatch', async () => {
    const requestId = `dispatch-race-${randomUUID()}`;
    let guards = 0;
    const operation = jest.fn(async () => 'stale owner must never dispatch');
    const dispatch = runWithInferenceExecutionContext(
      {
        requestId,
        attempt: 1,
        assertRunnable: async () => {
          if (++guards !== 3) return;
          await db.transaction(async (manager) => {
            await manager.query(
              `UPDATE inference_resources SET status = 'RECONCILING' WHERE "resourceKey" = $1`,
              ['integration:shared'],
            );
            await manager.query(
              `UPDATE inference_model_executions SET status = 'RECONCILING' WHERE "requestId" = $1`,
              [requestId],
            );
          });
        },
      },
      () => gate.execute('chat', operation),
    );
    await expect(dispatch).rejects.toMatchObject({ code: 'RESOURCE_RECONCILIATION_REQUIRED' });
    expect(guards).toBe(3);
    expect(operation).not.toHaveBeenCalled();
    expect(
      await db
        .getRepository(InferenceResourceEntity)
        .findOneByOrFail({ resourceKey: 'integration:shared' }),
    ).toMatchObject({ status: 'RECONCILING' });
  });

  it('keeps timeout completion uncertainty DRAINING, blocks queued and new work, requires evidence to release', async () => {
    const release = deferred();
    const started = deferred();
    const first = gate.execute('chat', async () => {
      started.resolve();
      await release.promise;
      throw Object.assign(new Error('HTTP timeout'), { code: 'ECONNABORTED' });
    });
    const firstResult = first.catch((error: unknown) => error);
    await started.promise;
    const waiterOperation = jest.fn(async () => 'must not run');
    const waiterResult = gate.execute('vision', waiterOperation).catch((error: unknown) => error);
    await eventually(async () =>
      expect(
        await db.getRepository(InferenceModelExecutionEntity).countBy({ status: 'WAITING' }),
      ).toBe(1),
    );
    release.resolve();
    expect(await firstResult).toMatchObject({ code: 'MODEL_COMPLETION_UNCERTAIN' });
    expect(await waiterResult).toMatchObject({ code: 'RESOURCE_RECONCILIATION_REQUIRED' });
    expect(waiterOperation).not.toHaveBeenCalled();
    const resource = await db
      .getRepository(InferenceResourceEntity)
      .findOneByOrFail({ resourceKey: 'integration:shared' });
    expect(resource.status).toBe('DRAINING');
    const subsequentOperation = jest.fn(async () => 'must not run');
    await expect(gate.execute('chat', subsequentOperation)).rejects.toMatchObject({
      code: 'RESOURCE_RECONCILIATION_REQUIRED',
    });
    expect(subsequentOperation).not.toHaveBeenCalled();
    await expect(
      gate.reconcile({
        resourceKey: resource.resourceKey,
        executionId: resource.activeExecutionId!,
        actor: 'integration-operator',
        confirmation: 'model-server-restarted',
        reference: 'short',
        ownerStopped: true,
        ownerStopReference: 'stub-executor-process-stop-event-2026-10-18',
      }),
    ).rejects.toThrow('evidence');
    const reconciliation: ReconciliationEvidence = {
      resourceKey: resource.resourceKey,
      executionId: resource.activeExecutionId!,
      actor: 'integration-operator',
      confirmation: 'model-server-restarted',
      reference: 'stub-model-restart-event-2026-10-18',
      ownerStopped: true,
      ownerStopReference: 'stub-executor-process-stop-event-2026-10-18',
    };
    const missingOwnerStop: Partial<ReconciliationEvidence> = { ...reconciliation };
    delete missingOwnerStop.ownerStopped;
    await expect(gate.reconcile(missingOwnerStop as ReconciliationEvidence)).rejects.toThrow();
    await expect(
      gate.reconcile({ ...reconciliation, ownerStopReference: 'short' }),
    ).rejects.toThrow();
    expect(
      (
        await db
          .getRepository(InferenceResourceEntity)
          .findOneByOrFail({ resourceKey: resource.resourceKey })
      ).status,
    ).toBe('DRAINING');
    await gate.reconcile(reconciliation);
    const execution = await db
      .getRepository(InferenceModelExecutionEntity)
      .findOneByOrFail({ id: resource.activeExecutionId! });
    expect(execution.status).toBe('RECONCILED');
    expect(execution.evidence).toMatchObject({
      reconciliation: {
        actor: 'integration-operator',
        reference: 'stub-model-restart-event-2026-10-18',
        ownerStopped: true,
        ownerStopReference: 'stub-executor-process-stop-event-2026-10-18',
      },
    });
    await expect(gate.execute('chat', async () => 'safe after evidence')).resolves.toBe(
      'safe after evidence',
    );
  });

  it('never treats a stale owner heartbeat as permission for automatic takeover', async () => {
    const id = randomUUID();
    await db.getRepository(InferenceResourceEntity).save({
      resourceKey: 'integration:shared',
      device: 'cpu',
      status: 'RUNNING',
      activeExecutionId: id,
    });
    await db.getRepository(InferenceModelExecutionEntity).save({
      id,
      resourceKey: 'integration:shared',
      requestId: 'dead-worker',
      attempt: 1,
      workload: 'chat',
      status: 'RUNNING',
      ownerToken: randomUUID(),
      queuedAt: new Date(Date.now() - 30000),
      waitDeadlineAt: new Date(Date.now() - 20000),
      startedAt: new Date(Date.now() - 30000),
      heartbeatAt: new Date(Date.now() - 30000),
      evidence: {},
    });
    const operation = jest.fn(async () => 'unsafe takeover');
    await expect(gate.execute('vision', operation)).rejects.toMatchObject({
      code: 'RESOURCE_RECONCILIATION_REQUIRED',
    });
    expect(operation).not.toHaveBeenCalled();
    expect(
      await db
        .getRepository(InferenceResourceEntity)
        .findOneByOrFail({ resourceKey: 'integration:shared' }),
    ).toMatchObject({ status: 'RECONCILING', activeExecutionId: id });
    expect(
      await db.getRepository(InferenceModelExecutionEntity).findOneByOrFail({ id }),
    ).toMatchObject({ status: 'RECONCILING' });
  });

  it('allows a confirmed HTTP 4xx rejection to release the resource but quarantines proxy 504', async () => {
    const rejected = Object.assign(new Error('bad request'), { response: { status: 400 } });
    await expect(
      gate.execute('chat', async () => {
        throw rejected;
      }),
    ).rejects.toBe(rejected);
    await expect(gate.execute('chat', async () => 'next')).resolves.toBe('next');
    await expect(
      gate.execute('chat', async () => {
        throw Object.assign(new Error('gateway'), { response: { status: 504 } });
      }),
    ).rejects.toMatchObject({ code: 'MODEL_COMPLETION_UNCERTAIN' });
    expect(
      await db
        .getRepository(InferenceResourceEntity)
        .findOneByOrFail({ resourceKey: 'integration:shared' }),
    ).toMatchObject({ status: 'DRAINING' });
  });

  it('releases ownership after a real loopback connection refusal establishes that HTTP never dispatched', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await expect(
      gate.execute('chat', () =>
        axios.post(
          `http://127.0.0.1:${port}/inference`,
          {},
          {
            maxRedirects: 0,
            timeout: 500,
            proxy: false,
          },
        ),
      ),
    ).rejects.toMatchObject({ isAxiosError: true, code: 'ECONNREFUSED' });
    expect(
      await db
        .getRepository(InferenceResourceEntity)
        .findOneByOrFail({ resourceKey: 'integration:shared' }),
    ).toMatchObject({ status: 'READY', activeExecutionId: null });
    expect(
      await db.getRepository(InferenceModelExecutionEntity).countBy({ status: 'HTTP_REJECTED' }),
    ).toBe(1);
    await expect(gate.execute('chat', async () => 'next healthy dispatch')).resolves.toBe(
      'next healthy dispatch',
    );
  });

  it('validates real migration up/down, duplicate active-owner protection, and legacy generating-trip refusal', async () => {
    const runner = db.createQueryRunner();
    await runner.connect();
    try {
      await runner.query(`DROP SCHEMA IF EXISTS ${MIGRATION_SCHEMA} CASCADE`);
      await runner.query(`CREATE SCHEMA ${MIGRATION_SCHEMA}`);
      await runner.query(`SET search_path TO ${MIGRATION_SCHEMA}, public`);
      await runner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public');
      await runner.query('CREATE TABLE trips (id uuid PRIMARY KEY, status varchar NOT NULL)');
      const ledgerMigration = new GenerationRequestLedger1792250000000();
      const resourceMigration = new InferenceResourceGate1792300001000();
      await runner.query("INSERT INTO trips (id, status) VALUES ($1, 'generating')", [
        randomUUID(),
      ]);
      await expect(ledgerMigration.up(runner)).rejects.toThrow('Drain and reconcile');
      await runner.query('DELETE FROM trips');
      await ledgerMigration.up(runner);
      await resourceMigration.up(runner);
      const insert = `INSERT INTO inference_model_executions
        ("resourceKey", "requestId", attempt, workload, status, "ownerToken", "waitDeadlineAt")
        VALUES ('migration:shared', $1, 1, 'chat', 'RUNNING', $2, NOW())`;
      await runner.query(insert, ['owner-one', randomUUID()]);
      await expect(runner.query(insert, ['owner-two', randomUUID()])).rejects.toMatchObject({
        code: '23505',
      });
      await resourceMigration.down(runner);
      await ledgerMigration.down(runner);
      const remaining: Array<{ table_name: string }> = await runner.query(
        'SELECT table_name FROM information_schema.tables WHERE table_schema = $1',
        [MIGRATION_SCHEMA],
      );
      expect(remaining.map((row) => row.table_name)).toEqual(['trips']);
    } finally {
      await runner.query(`SET search_path TO ${SCHEMA}, public`);
      await runner.query(`DROP SCHEMA IF EXISTS ${MIGRATION_SCHEMA} CASCADE`);
      await runner.release();
    }
  });
});
