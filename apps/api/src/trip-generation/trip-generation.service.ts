import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import type { TripGenerationJobDto, TripGenerationStage, TripStatus } from '@tripick/types';
import { withTimeout } from '../common/with-timeout';
import { GenerationLedgerService } from './generation-ledger.service';
import { GenerationRequestEntity } from './generation-request.entity';
import { GENERATE_TRIP_JOB, TRIP_GENERATION_QUEUE, TRIP_GENERATION_QUEUE_TIMEOUT_MS,
  type TripGenerationJobData, type TripGenerationJobResult, tripGenerationJobId,
} from './trip-generation.constants';

type GenerationJob = Job<TripGenerationJobData, TripGenerationJobResult>;
const GENERATION_STAGES = new Set<TripGenerationStage>(['queued', 'preparing', 'discovering_places', 'building_itinerary', 'saving', 'completed']);

@Injectable()
export class TripGenerationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TripGenerationService.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private publishing = false;
  constructor(
    @InjectQueue(TRIP_GENERATION_QUEUE) private readonly queue: Queue<TripGenerationJobData, TripGenerationJobResult>,
    readonly ledger: GenerationLedgerService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => { void this.publishPending(); }, 3000);
    this.timer.unref();
    void this.publishPending();
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  /** A wakeup hint only: the request was already committed with its durable publish intent. */
  async enqueue(data: TripGenerationJobData): Promise<TripGenerationJobDto> {
    if (!data.generationId) throw new BadRequestException('일정 생성 원장 접수가 필요합니다.');
    void this.publishPending();
    return this.getStatus(data.tripId, 'generating');
  }

  /** One transaction-scoped publisher lock preserves first publication FIFO across API replicas. */
  async publishPending(): Promise<void> {
    if (this.publishing) return;
    this.publishing = true;
    try {
      // The ledger owns admission. Its datasource is intentionally accessed through this explicit helper.
      await this.ledger.publishPending(async (row) => {
        const data = { tripId: row.tripId, userId: row.userId, generationId: row.id };
        const jobId = tripGenerationJobId(row.tripId, row.id);
        const existing = await withTimeout(this.queue.getJob(jobId), TRIP_GENERATION_QUEUE_TIMEOUT_MS, '발행 잡 조회 지연');
        if (existing) {
          const state = await withTimeout(existing.getState(), TRIP_GENERATION_QUEUE_TIMEOUT_MS, '발행 잡 상태 조회 지연');
          if (state === 'active') return false;
          if (['completed', 'failed'].includes(state)) await withTimeout(existing.remove(), TRIP_GENERATION_QUEUE_TIMEOUT_MS, '종료 잡 정리 지연');
          else return true;
        }
        await withTimeout(this.queue.add(GENERATE_TRIP_JOB, data, {
          jobId, attempts: row.maxAttempts,
          backoff: { type: 'fixed', delay: 2000 },
          removeOnComplete: { age: 3600, count: 500 }, removeOnFail: { age: 86_400, count: 500 },
        }), TRIP_GENERATION_QUEUE_TIMEOUT_MS, '일정 생성 발행 응답 없음');
        return true;
      });
    } catch (error) {
      // The transaction rolls back publishedAt. A successful Redis add is deduplicated by immutable id.
      this.logger.warn(`일정 생성 outbox 재시도 대기: ${error instanceof Error ? error.message : String(error)}`);
    } finally { this.publishing = false; }
  }

  async getStatus(tripId: string, tripStatus: TripStatus): Promise<TripGenerationJobDto> {
    const row = await this.ledger.latest(tripId);
    if (row) return this.describe(row);
    return {
      tripId,
      status: ['confirmed', 'in_progress', 'completed'].includes(tripStatus) ? 'completed' : tripStatus === 'generation_failed' ? 'failed' : tripStatus === 'cancelled' ? 'cancelled' : 'unavailable',
      stage: ['confirmed', 'in_progress', 'completed'].includes(tripStatus) ? 'completed' : 'queued',
      progress: ['confirmed', 'in_progress', 'completed'].includes(tripStatus) ? 100 : 0,
      attempt: 0, maxAttempts: 3, canCancel: false,
    };
  }

  async retry(tripId: string, userId: string, requestKey?: string): Promise<TripGenerationJobDto> {
    const row = await this.ledger.retry(tripId, userId, requestKey);
    void this.publishPending();
    return this.describe(row);
  }
  async cancel(tripId: string, userId: string, tripStatus: TripStatus = 'generating'): Promise<TripGenerationJobDto> {
    const row = await this.ledger.cancel(tripId, userId);
    return row ? this.describe(row) : this.getStatus(tripId, tripStatus);
  }
  assertRetryable(status: TripStatus): void {
    if (status !== 'generation_failed') throw new BadRequestException('최종 실패한 일정만 다시 생성할 수 있습니다.');
  }

  private async describe(row: GenerationRequestEntity): Promise<TripGenerationJobDto> {
    const status = row.state === 'succeeded' ? 'completed' : row.state === 'running' ? 'processing'
      : row.state === 'queued' && row.attempt > 0 ? 'retrying' : row.state;
    let progress = { stage: 'queued' as TripGenerationStage, progress: row.state === 'queued' ? 5 : 0 };
    if (row.state === 'running') {
      // Redis is optional display data. Its outage cannot erase a DB-owned accepted request.
      try {
        const job = await withTimeout(this.queue.getJob(tripGenerationJobId(row.tripId, row.id)),
          1000, '진행률 조회 지연');
        if (job) progress = this.progress(job);
      } catch { /* persisted state remains authoritative */ }
    }
    return { tripId: row.tripId, generationId: row.id, requestState: row.state, status,
      stage: row.state === 'succeeded' ? 'completed' : progress.stage,
      progress: row.state === 'succeeded' ? 100 : progress.progress,
      attempt: row.attempt, maxAttempts: row.maxAttempts,
      canCancel: ['queued', 'running'].includes(row.state),
      ...(row.error ? { error: row.error } : {}),
    };
  }
  private progress(job: GenerationJob): { stage: TripGenerationStage; progress: number } {
    const value = job.progress;
    if (typeof value === 'object' && value !== null) {
      const candidate = value as { stage?: unknown; progress?: unknown };
      if (typeof candidate.stage === 'string' && GENERATION_STAGES.has(candidate.stage as TripGenerationStage)
        && typeof candidate.progress === 'number' && Number.isFinite(candidate.progress)) {
        return { stage: candidate.stage as TripGenerationStage, progress: Math.min(99, Math.max(0, Math.round(candidate.progress))) };
      }
    }
    return { stage: 'preparing', progress: 10 };
  }
}
