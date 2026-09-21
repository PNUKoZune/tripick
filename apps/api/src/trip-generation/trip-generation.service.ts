import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import type {
  TripGenerationJobDto,
  TripGenerationStage,
  TripStatus,
} from '@tripick/types';
import { withTimeout } from '../common/with-timeout';
import {
  GENERATE_TRIP_JOB,
  TRIP_GENERATION_QUEUE,
  TRIP_GENERATION_QUEUE_TIMEOUT_MS,
  type TripGenerationJobData,
  type TripGenerationJobResult,
  tripGenerationJobId,
} from './trip-generation.constants';

type GenerationJob = Job<TripGenerationJobData, TripGenerationJobResult>;
const GENERATION_STAGES = new Set<TripGenerationStage>([
  'queued',
  'preparing',
  'discovering_places',
  'building_itinerary',
  'saving',
  'completed',
]);

@Injectable()
export class TripGenerationService {
  private readonly logger = new Logger(TripGenerationService.name);

  constructor(
    @InjectQueue(TRIP_GENERATION_QUEUE)
    private readonly queue: Queue<TripGenerationJobData, TripGenerationJobResult>,
  ) {}

  /**
   * trip 당 결정적인 jobId 하나만 등록한다. 같은 trip의 큐 등록이 재시도돼도 LLM 작업은 중복되지 않는다.
   * 완료·실패 잡은 재생성 요청 때 제거한 뒤 같은 id를 재사용한다.
   */
  async enqueue(data: TripGenerationJobData): Promise<TripGenerationJobDto> {
    const jobId = tripGenerationJobId(data.tripId);
    const existing = await this.queueCall(
      this.queue.getJob(jobId),
      '기존 일정 생성 잡 조회 응답 없음',
    );
    if (existing) {
      const state = await this.queueCall(
        existing.getState(),
        '기존 일정 생성 잡 상태 조회 응답 없음',
      );
      if (!['completed', 'failed', 'unknown'].includes(state)) {
        return this.describe(existing, 'generating');
      }
      await this.queueCall(existing.remove(), '기존 일정 생성 잡 정리 응답 없음');
    }

    const job = await this.queueCall(
      this.queue.add(GENERATE_TRIP_JOB, data, {
        jobId,
        removeOnComplete: { age: 3600, count: 500 },
        removeOnFail: { age: 86_400, count: 500 },
      }),
      '일정 생성 잡 등록 응답 없음',
    );
    return this.describe(job, 'generating');
  }

  async getStatus(tripId: string, tripStatus: TripStatus): Promise<TripGenerationJobDto> {
    // 완료는 DB가 정본이다. 완료 잡 보관 시간이 지났거나 Redis가 잠깐 죽어도 결과 화면에 진입한다.
    if (tripStatus === 'confirmed' || tripStatus === 'in_progress' || tripStatus === 'completed') {
      return this.terminal(tripId, 'completed');
    }

    // 최종 실패도 DB에 남는다. 실패 이유 조회가 안 되더라도 재시도 UI는 복구할 수 있다.
    if (tripStatus === 'generation_failed') {
      const job = await this.tryGetJob(tripId);
      return {
        ...this.terminal(tripId, 'failed'),
        ...(job?.failedReason ? { error: job.failedReason } : {}),
      };
    }

    const job = await this.queueCall(
      this.queue.getJob(tripGenerationJobId(tripId)),
      '일정 생성 상태 조회 응답 없음',
    );
    if (!job) {
      return {
        ...this.terminal(tripId, 'unavailable'),
        error: '일정 생성 작업을 찾지 못했어요. 잠시 후 다시 확인해주세요.',
      };
    }
    return this.describe(job, tripStatus);
  }

  assertRetryable(status: TripStatus): void {
    if (status !== 'generation_failed') {
      throw new BadRequestException('최종 실패한 일정만 다시 생성할 수 있습니다.');
    }
  }

  private async tryGetJob(tripId: string): Promise<GenerationJob | null> {
    return withTimeout(
      this.queue.getJob(tripGenerationJobId(tripId)),
      TRIP_GENERATION_QUEUE_TIMEOUT_MS,
      '실패한 일정 생성 잡 조회 응답 없음',
    )
      .then((job) => job ?? null)
      .catch((error: unknown) => {
        this.logger.warn(
          `Trip ${tripId} 실패 이유 조회 생략: ${error instanceof Error ? error.message : String(error)}`,
        );
        return null;
      });
  }

  private async describe(job: GenerationJob, tripStatus: TripStatus): Promise<TripGenerationJobDto> {
    const state = await this.queueCall(job.getState(), '일정 생성 잡 상태 조회 응답 없음');
    const maxAttempts = job.opts.attempts ?? 1;
    const rawProgress = this.progress(job);
    const retrying = job.attemptsMade > 0 && ['waiting', 'delayed', 'active'].includes(state);
    const status =
      tripStatus === 'generation_failed' || state === 'failed'
        ? 'failed'
        : state === 'completed'
          ? 'completed'
          : retrying
            ? 'retrying'
            : state === 'active'
              ? 'processing'
              : ['waiting', 'waiting-children', 'delayed'].includes(state)
                ? 'queued'
                : 'unavailable';

    return {
      tripId: job.data.tripId,
      status,
      stage: status === 'completed' ? 'completed' : rawProgress.stage,
      progress: status === 'completed' ? 100 : rawProgress.progress,
      attempt: Math.min(
        maxAttempts,
        Math.max(1, job.attemptsMade + (state === 'active' ? 1 : 0)),
      ),
      maxAttempts,
      ...(status === 'failed'
        ? { error: job.failedReason || '일정을 생성하지 못했어요. 다시 시도해주세요.' }
        : {}),
    };
  }

  private progress(job: GenerationJob): { stage: TripGenerationStage; progress: number } {
    const value = job.progress;
    if (typeof value === 'object' && value !== null) {
      const candidate = value as { stage?: unknown; progress?: unknown };
      if (
        typeof candidate.stage === 'string' &&
        GENERATION_STAGES.has(candidate.stage as TripGenerationStage) &&
        typeof candidate.progress === 'number' &&
        Number.isFinite(candidate.progress)
      ) {
        return {
          stage: candidate.stage as TripGenerationStage,
          progress: Math.min(99, Math.max(0, Math.round(candidate.progress))),
        };
      }
    }
    return { stage: 'queued', progress: 5 };
  }

  private terminal(
    tripId: string,
    status: 'completed' | 'failed' | 'unavailable',
  ): TripGenerationJobDto {
    return {
      tripId,
      status,
      stage: status === 'completed' ? 'completed' : 'queued',
      progress: status === 'completed' ? 100 : 0,
      attempt: status === 'completed' ? 1 : 0,
      maxAttempts: 3,
      ...(status === 'failed'
        ? { error: '일정을 생성하지 못했어요. 다시 시도해주세요.' }
        : {}),
    };
  }

  private async queueCall<T>(promise: Promise<T>, label: string): Promise<T> {
    return withTimeout(promise, TRIP_GENERATION_QUEUE_TIMEOUT_MS, label).catch(
      (error: unknown) => {
        this.logger.error(error instanceof Error ? error.message : String(error));
        throw new ServiceUnavailableException(
          '지금은 일정 생성 서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.',
        );
      },
    );
  }
}
