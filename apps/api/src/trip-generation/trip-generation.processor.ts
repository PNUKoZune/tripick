import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, UnrecoverableError } from 'bullmq';
import type { TripGenerationStage } from '@tripick/types';
import { PlannerService, type PlannerExecutionGuard } from '../planner/planner.service';
import { runWithInferenceExecutionContext } from '../inference-resource/inference-execution-context';
import { GenerationNotRunnableError } from './generation-errors';
import { GenerationLedgerService } from './generation-ledger.service';
import {
  GENERATE_TRIP_JOB,
  TRIP_GENERATION_QUEUE,
  type TripGenerationJobData,
  type TripGenerationJobResult,
} from './trip-generation.constants';

const DEFAULT_DEADLINE_MS = 5 * 60_000;

// Shared queue concurrency is verified before TripGenerationQueuePolicy starts this worker.
@Processor(TRIP_GENERATION_QUEUE, { concurrency: 1, autorun: false })
export class TripGenerationProcessor extends WorkerHost {
  private readonly logger = new Logger(TripGenerationProcessor.name);

  constructor(
    private readonly plannerService: PlannerService,
    private readonly ledger: GenerationLedgerService,
    private readonly config: ConfigService,
  ) {
    super();
  }

  async process(
    job: Job<TripGenerationJobData, TripGenerationJobResult>,
  ): Promise<TripGenerationJobResult> {
    if (job.name !== GENERATE_TRIP_JOB) {
      throw new Error(`지원하지 않는 일정 생성 잡입니다: ${job.name}`);
    }

    const execution = await this.ledger.claim(job.data);
    if (!execution) return { tripId: job.data.tripId, itemCount: 0, skipped: true };

    const startedAt = Date.now();
    const startedCpu = process.cpuUsage();
    let lastStageAt = startedAt;
    let outcome = 'failed';
    const configured = Number(this.config.get('TRIP_GENERATION_DEADLINE_MS', DEFAULT_DEADLINE_MS));
    const deadlineMs = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_DEADLINE_MS;
    const deadlineAt = startedAt + deadlineMs;
    const deadlineError = new UnrecoverableError('일정 생성 전체 실행 제한 시간을 초과했습니다.');
    let expired = false;
    let expiration: Promise<void> | undefined;
    const fence = (): Promise<void> => {
      expiration ??= this.ledger.expire(execution);
      // The planner remains awaited. A deadline fences writes but never releases a live run.
      void expiration.catch((error: unknown) => this.logger.error(
        `Generation deadline fencing failed: ${error instanceof Error ? error.message : String(error)}`,
      ));
      return expiration;
    };
    const expire = (): Promise<void> => {
      expired = true;
      return fence();
    };
    const assertDeadline = () => {
      if (expired || Date.now() >= deadlineAt) throw deadlineError;
    };
    const guard: PlannerExecutionGuard = {
      assertRunnable: async () => {
        if (expired || Date.now() >= deadlineAt) {
          await expire();
          throw deadlineError;
        }
        await this.ledger.assertRunnable(execution);
        assertDeadline();
      },
      commit: async (write) => {
        await guard.assertRunnable();
        return this.ledger.commit(execution, async (manager) => {
          // Waiting for the row lock also counts towards the whole-run deadline.
          assertDeadline();
          const result = await write(manager);
          assertDeadline();
          return result;
        });
      },
    };
    const timer = setTimeout(() => { void expire(); }, deadlineMs);
    timer.unref?.();
    const report = async (stage: TripGenerationStage, progress: number): Promise<void> => {
      const now = Date.now();
      const stageElapsedMs = now - lastStageAt;
      lastStageAt = now;
      await this.report(job, stage, progress, stageElapsedMs);
    };
    this.logger.log(JSON.stringify({
      event: 'trip_generation_started', requestId: execution.id, version: execution.version,
      tripId: job.data.tripId, queueWaitMs: Math.max(0, startedAt - job.timestamp),
    }));

    try {
      const items = await runWithInferenceExecutionContext(
        { requestId: execution.id, attempt: execution.version, assertRunnable: () => guard.assertRunnable() },
        () => this.plannerService.generateItinerary(job.data.tripId, report, guard),
      );
      await report('completed', 100);
      outcome = 'completed';
      this.logger.log(JSON.stringify({
        event: 'trip_generation_completed', requestId: execution.id,
        tripId: job.data.tripId, itemCount: items.length, durationMs: Date.now() - startedAt,
      }));
      return { tripId: job.data.tripId, itemCount: items.length };
    } catch (error) {
      const uncertain = this.isUncertainModelCompletion(error);
      if (expired || this.containsError(error, (candidate) => candidate === deadlineError)) await expire();
      if (uncertain) await fence();
      const cancelled = this.containsError(error, (candidate) => candidate instanceof GenerationNotRunnableError);
      await this.ledger.fail(execution, error, expired || uncertain || cancelled || this.isFinalAttempt(job));
      if (expired) throw deadlineError;
      if (uncertain) throw new UnrecoverableError(error instanceof Error ? error.message : String(error));
      if (cancelled) {
        outcome = 'cancelled';
        return { tripId: job.data.tripId, itemCount: 0, skipped: true };
      }
      throw error;
    } finally {
      clearTimeout(timer);
      const cpu = process.cpuUsage(startedCpu);
      this.logger.log(JSON.stringify({
        event: 'trip_generation_finished', requestId: execution.id, tripId: job.data.tripId,
        outcome, runMs: Date.now() - startedAt, cpuUserMs: cpu.user / 1000,
        cpuSystemMs: cpu.system / 1000, rssBytes: process.memoryUsage().rss,
      }));
    }
  }

  private async report(
    job: Job<TripGenerationJobData, TripGenerationJobResult>,
    stage: TripGenerationStage,
    progress: number,
    stageElapsedMs: number,
  ): Promise<void> {
    this.logger.log(JSON.stringify({ event: 'trip_generation_stage', tripId: job.data.tripId, stage, progress, stageElapsedMs }));
    await job.updateProgress({ stage, progress });
  }

  private isUncertainModelCompletion(error: unknown): boolean {
    return this.containsError(error, (candidate) => candidate instanceof Error && 'code' in candidate &&
      ['MODEL_COMPLETION_UNCERTAIN', 'RESOURCE_RECONCILIATION_REQUIRED'].includes(String(candidate.code)));
  }

  private containsError(error: unknown, predicate: (candidate: unknown) => boolean): boolean {
    return predicate(error) || (error instanceof AggregateError &&
      error.errors.some((nested: unknown) => this.containsError(nested, predicate)));
  }

  private isFinalAttempt(job: Job): boolean {
    return job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
  }
}
