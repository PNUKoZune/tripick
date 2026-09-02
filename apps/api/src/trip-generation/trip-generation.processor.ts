import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import type { TripGenerationStage } from '@tripick/types';
import { PlannerService } from '../planner/planner.service';
import { TripEntity } from '../trips/trip.entity';
import {
  GENERATE_TRIP_JOB,
  TRIP_GENERATION_QUEUE,
  type TripGenerationJobData,
  type TripGenerationJobResult,
} from './trip-generation.constants';

// chat 모델은 단일 llama.cpp 인스턴스다. HTTP 요청은 큐로 즉시 반환하되 GPU 추론은 직렬화해
// 컨텍스트 경합과 타임아웃 연쇄를 막는다.
@Processor(TRIP_GENERATION_QUEUE, { concurrency: 1 })
export class TripGenerationProcessor extends WorkerHost {
  private readonly logger = new Logger(TripGenerationProcessor.name);

  constructor(
    @InjectRepository(TripEntity)
    private readonly tripsRepo: Repository<TripEntity>,
    private readonly plannerService: PlannerService,
  ) {
    super();
  }

  async process(
    job: Job<TripGenerationJobData, TripGenerationJobResult>,
  ): Promise<TripGenerationJobResult> {
    if (job.name !== GENERATE_TRIP_JOB) {
      throw new Error(`지원하지 않는 일정 생성 잡입니다: ${job.name}`);
    }

    const trip = await this.tripsRepo.findOneBy({ id: job.data.tripId });
    if (!trip) return { tripId: job.data.tripId, itemCount: 0, skipped: true };
    if (trip.userId !== job.data.userId) {
      throw new Error(`일정 생성 잡 소유자 불일치: trip=${trip.id}`);
    }
    // DB 확정 이후 Worker만 재시도된 경우 결과를 다시 덮어쓰지 않는다.
    if (['confirmed', 'in_progress', 'completed'].includes(trip.status)) {
      await this.report(job, 'completed', 100);
      return { tripId: trip.id, itemCount: 0, skipped: true };
    }
    if (trip.status === 'cancelled') {
      return { tripId: trip.id, itemCount: 0, skipped: true };
    }

    const startedAt = Date.now();
    try {
      const items = await this.plannerService.generateItinerary(trip.id, (stage, progress) =>
        this.report(job, stage, progress),
      );
      await this.report(job, 'completed', 100);
      this.logger.log(
        `Trip ${trip.id} 초기 일정 ${items.length}개 생성 완료 (${Date.now() - startedAt}ms)`,
      );
      return { tripId: trip.id, itemCount: items.length };
    } catch (error) {
      if (this.isFinalAttempt(job)) {
        await this.tripsRepo.update({ id: trip.id }, { status: 'generation_failed' });
      }
      throw error;
    }
  }

  private report(
    job: Job<TripGenerationJobData, TripGenerationJobResult>,
    stage: TripGenerationStage,
    progress: number,
  ): Promise<void> {
    return job.updateProgress({ stage, progress });
  }

  private isFinalAttempt(job: Job): boolean {
    return job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
  }
}
