import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, In } from 'typeorm';
import { TripEntity } from '../trips/trip.entity';
import { GenerationRequestEntity, UNFINISHED_GENERATION_STATES } from './generation-request.entity';
import { GenerationAdmissionException, GenerationNotRunnableError } from './generation-errors';
import type { TripGenerationJobData } from './trip-generation.constants';

export type GenerationExecution = { id: string; version: number };
const ADMISSION_LOCK = 7_341_901;
const MAX_WAITING = 20;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

@Injectable()
export class GenerationLedgerService {
  constructor(private readonly dataSource: DataSource, private readonly config: ConfigService = new ConfigService()) {}

  /** The global lock protects both the user admission check and the bounded queue count. */
  async admit(
    userId: string, requestKey: string | undefined, input: unknown,
    create: (manager: EntityManager) => Promise<TripEntity>,
  ): Promise<{ trip: TripEntity; request: GenerationRequestEntity; replayed: boolean }> {
    const key = this.requestKey(requestKey);
    const inputHash = createHash('sha256').update(canonical(input)).digest('hex');
    return this.dataSource.transaction(async (manager) => {
      await this.admissionLock(manager);
      const requests = manager.getRepository(GenerationRequestEntity);
      const existing = await requests.findOneBy({ userId, requestKey: key });
      if (existing) {
        if (existing.inputHash !== inputHash) throw new ConflictException('같은 Idempotency-Key에 다른 입력을 사용할 수 없습니다.');
        const trip = await manager.getRepository(TripEntity).findOneByOrFail({ id: existing.tripId, userId });
        return { trip, request: existing, replayed: true };
      }
      await this.assertCapacity(manager, userId);
      const trip = await create(manager);
      const request = await requests.save(requests.create({ tripId: trip.id, userId,
        requestKey: key, inputHash, state: 'queued', version: 0, attempt: 0, maxAttempts: 3,
        publishedAt: null, startedAt: null, finishedAt: null, error: null,
      }));
      return { trip, request, replayed: false };
    });
  }

  async retry(tripId: string, userId: string, requestKey?: string): Promise<GenerationRequestEntity> {
    const key = this.requestKey(requestKey);
    return this.dataSource.transaction(async (manager) => {
      await this.admissionLock(manager);
      const requests = manager.getRepository(GenerationRequestEntity);
      const prior = await requests.findOneBy({ userId, requestKey: key });
      if (prior) {
        if (prior.tripId !== tripId) throw new ConflictException('다른 여행에 사용된 Idempotency-Key입니다.');
        return prior;
      }
      const trip = await manager.getRepository(TripEntity).findOneByOrFail({ id: tripId, userId });
      const latest = await requests.findOne({ where: { tripId }, order: { admissionOrder: 'DESC' } });
      if (trip.status !== 'generation_failed' || (latest && latest.state !== 'failed')) {
        throw new BadRequestException('최종 실패한 일정만 다시 생성할 수 있습니다.');
      }
      await this.assertCapacity(manager, userId);
      const request = await requests.save(requests.create({ tripId, userId, requestKey: key,
        inputHash: createHash('sha256').update(`retry:${tripId}`).digest('hex'), state: 'queued',
        version: 0, attempt: 0, maxAttempts: 3, publishedAt: null, startedAt: null, finishedAt: null, error: null,
      }));
      await manager.getRepository(TripEntity).update({ id: tripId }, { status: 'generating' });
      return request;
    });
  }

  latest(tripId: string): Promise<GenerationRequestEntity | null> {
    return this.dataSource.getRepository(GenerationRequestEntity).findOne({
      where: { tripId }, order: { admissionOrder: 'DESC' },
    });
  }

  async mutateTrip<T>(tripId: string, write: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      // Serialize with retry admission as well as claim/cancel/final commit.
      await this.admissionLock(manager);
      const request = await manager.getRepository(GenerationRequestEntity).findOne({ where: { tripId },
        order: { admissionOrder: 'DESC' }, lock: { mode: 'pessimistic_write' } });
      if (request && (UNFINISHED_GENERATION_STATES as readonly string[]).includes(request.state)) {
        throw new ConflictException('일정 생성이 진행 중입니다. 취소 또는 종료 확인 후 수정·삭제해주세요.');
      }
      return write(manager);
    });
  }

  async publishPending(publish: (request: GenerationRequestEntity) => Promise<boolean>): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const locks: Array<{ locked: boolean }> = await manager.query('SELECT pg_try_advisory_xact_lock($1) AS locked', [7_341_902]);
      if (!locks[0]?.locked) return;
      const requests = manager.getRepository(GenerationRequestEntity);
      const rows = await requests.createQueryBuilder('request').where('request.state = :state', { state: 'queued' })
        // Also verify already-published waiting requests: Redis data loss must not strand DB work.
        .orderBy('request.admissionOrder', 'ASC')
        .take(MAX_WAITING).setLock('pessimistic_write').getMany();
      for (const row of rows) {
        if (!await publish(row)) break;
        row.publishedAt ??= new Date();
        await requests.save(row);
      }
    });
  }

  async cancel(tripId: string, userId: string): Promise<GenerationRequestEntity | null> {
    return this.dataSource.transaction(async (manager) => {
      const row = await manager.getRepository(GenerationRequestEntity).findOne({ where: { tripId, userId },
        order: { admissionOrder: 'DESC' }, lock: { mode: 'pessimistic_write' } });
      if (!row) return null;
      if (row.state === 'queued') {
        row.state = 'cancelled'; row.version += 1; row.finishedAt = new Date();
        await manager.getRepository(TripEntity).update({ id: tripId, userId }, { status: 'cancelled' });
      } else if (row.state === 'running') {
        // Keep the slot until the worker unwinds. State alone fences the final commit.
        row.state = 'cancel_requested';
      }
      return manager.save(row);
    });
  }

  async claim(data: TripGenerationJobData): Promise<GenerationExecution | null> {
    const generationId = data.generationId;
    if (!generationId) return null; // legacy Redis jobs have no durable execution authority
    return this.dataSource.transaction(async (manager) => {
      await this.admissionLock(manager);
      const row = await manager.getRepository(GenerationRequestEntity).findOne({
        where: { id: generationId, tripId: data.tripId, userId: data.userId }, lock: { mode: 'pessimistic_write' },
      });
      if (!row) return null;
      if (row.state === 'running' || row.state === 'cancel_requested') {
        // A stalled delivery is not evidence that the previous model execution stopped.
        row.state = 'reconciling'; row.version += 1;
        row.error = '이전 실행 종료 확인이 필요합니다.';
        await manager.save(row);
        return null;
      }
      if (row.state !== 'queued') return null;
      if (row.attempt >= row.maxAttempts) {
        // Delivery retry counters can reset after Redis loss. The durable budget cannot.
        row.state = 'failed'; row.version += 1; row.finishedAt = new Date();
        row.error = '일정을 생성하지 못했어요. 다시 시도해주세요.';
        await manager.save(row);
        await manager.getRepository(TripEntity).update({ id: row.tripId, status: 'generating' }, { status: 'generation_failed' });
        return null;
      }
      const blocked = await manager.getRepository(GenerationRequestEntity).count({ where: { state: 'reconciling' } });
      if (blocked) {
        // Complete only the delivery, not the accepted request. The durable publisher will
        // redeliver it after reconciliation instead of exhausting BullMQ's retry budget.
        row.publishedAt = null;
        await manager.save(row);
        return null;
      }
      row.state = 'running'; row.version += 1; row.attempt += 1; row.startedAt = new Date();
      await manager.save(row);
      return { id: row.id, version: row.version };
    });
  }

  async assertRunnable(execution: GenerationExecution): Promise<void> {
    const row = await this.dataSource.getRepository(GenerationRequestEntity).findOneBy({ id: execution.id });
    this.assertAuthority(row, execution);
  }

  async commit<T>(execution: GenerationExecution, write: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      const row = await this.lockExecution(manager, execution);
      this.assertAuthority(row, execution);
      const result = await write(manager);
      row!.state = 'succeeded'; row!.finishedAt = new Date(); row!.version += 1; row!.error = null;
      await manager.save(row!);
      await manager.getRepository(TripEntity).update({ id: row!.tripId, status: 'generating' }, { status: 'confirmed' });
      return result;
    });
  }

  async expire(execution: GenerationExecution): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const row = await this.lockExecution(manager, execution);
      if (!row || row.version !== execution.version || !['running', 'cancel_requested'].includes(row.state)) return;
      row.state = 'reconciling'; row.version += 1;
      row.error = '실행 기한을 초과했습니다. 모델 종료 확인이 필요합니다.';
      await manager.save(row);
    });
  }

  /** Operator-only service entry point: intentionally not exposed by an HTTP controller. */
  async quarantine(id: string, evidence: string): Promise<void> {
    if (evidence.trim().length < 12) throw new BadRequestException('실행 상태를 대조해야 하는 근거가 필요합니다.');
    await this.dataSource.transaction(async (manager) => {
      const row = await manager.getRepository(GenerationRequestEntity).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!row) throw new BadRequestException('대조할 요청을 찾지 못했습니다.');
      if (row.state === 'reconciling') return;
      if (!['running', 'cancel_requested'].includes(row.state)) {
        throw new BadRequestException('실행 중이거나 취소를 대기하는 요청만 격리할 수 있습니다.');
      }
      row.state = 'reconciling';
      row.version += 1;
      row.error = '이전 실행 종료 확인이 필요합니다.';
      row.reconciliationEvidence = [row.reconciliationEvidence,
        `${new Date().toISOString()} quarantine: ${evidence.trim()}`].filter(Boolean).join('\n');
      await manager.save(row);
    });
  }

  /** Operator-only release after model termination has independently been confirmed. */
  async reconcile(id: string, evidence: string, outcome: 'failed' | 'cancelled' = 'failed'): Promise<void> {
    if (evidence.trim().length < 12) throw new BadRequestException('모델 종료 또는 서버 재시작 확인 근거가 필요합니다.');
    await this.dataSource.transaction(async (manager) => {
      const row = await manager.getRepository(GenerationRequestEntity).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!row || row.state !== 'reconciling') throw new BadRequestException('대조 중인 요청만 해제할 수 있습니다.');
      row.state = outcome; row.version += 1; row.finishedAt = new Date();
      row.reconciliationEvidence = [row.reconciliationEvidence,
        `${new Date().toISOString()} ${outcome}: ${evidence.trim()}`].filter(Boolean).join('\n');
      row.error = outcome === 'failed' ? '실행 종료를 확인했어요. 일정을 다시 생성해주세요.' : null;
      await manager.save(row);
      await manager.getRepository(TripEntity).update({ id: row.tripId, status: 'generating' }, { status: outcome === 'failed' ? 'generation_failed' : 'cancelled' });
    });
  }

  async fail(execution: GenerationExecution, error: unknown, final: boolean): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const row = await this.lockExecution(manager, execution);
      if (!row || row.version !== execution.version || !['running', 'cancel_requested'].includes(row.state)) return;
      row.state = row.state === 'cancel_requested' ? 'cancelled' : final || row.attempt >= row.maxAttempts ? 'failed' : 'queued';
      row.version += 1;
      // Persist a stable public error, never model prompts, provider responses or credentials.
      row.error = row.state === 'failed' ? '일정을 생성하지 못했어요. 다시 시도해주세요.' : null;
      row.finishedAt = row.state === 'queued' ? null : new Date();
      await manager.save(row);
      if (row.state !== 'queued') await manager.getRepository(TripEntity).update({ id: row.tripId, status: 'generating' },
        { status: row.state === 'cancelled' ? 'cancelled' : 'generation_failed' });
    });
  }

  private requestKey(value?: string): string {
    if (value === undefined) return randomUUID();
    if (!/^[\x21-\x7e]{1,128}$/.test(value)) throw new BadRequestException('Idempotency-Key는 공백 없는 ASCII 1~128자여야 합니다.');
    return value;
  }
  private admissionLock(manager: EntityManager): Promise<unknown> {
    return manager.query('SELECT pg_advisory_xact_lock($1)', [ADMISSION_LOCK]);
  }
  private async assertCapacity(manager: EntityManager, userId: string): Promise<void> {
    if (String(this.config.get('TRIP_GENERATION_ADMISSION_ENABLED', 'true')).toLowerCase() === 'false') {
      throw new GenerationAdmissionException('GENERATION_ADMISSION_PAUSED');
    }
    const repo = manager.getRepository(GenerationRequestEntity);
    if (await repo.count({ where: { userId, state: In([...UNFINISHED_GENERATION_STATES]) } })) {
      throw new GenerationAdmissionException('USER_GENERATION_LIMIT');
    }
    if (await repo.count({ where: { state: 'queued' } }) >= MAX_WAITING) throw new GenerationAdmissionException('GENERATION_QUEUE_FULL');
  }
  private lockExecution(manager: EntityManager, execution: GenerationExecution): Promise<GenerationRequestEntity | null> {
    return manager.getRepository(GenerationRequestEntity).findOne({ where: { id: execution.id }, lock: { mode: 'pessimistic_write' } });
  }
  private assertAuthority(row: GenerationRequestEntity | null, execution: GenerationExecution): void {
    if (!row || row.version !== execution.version || row.state !== 'running') throw new GenerationNotRunnableError();
  }
}
