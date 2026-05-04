import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PlannerService } from '../planner/planner.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { REPLAN_QUEUE, REPLAN_JOB } from '../replanning/replanning.constants';
import type { ReplanRequestDto } from '@tripick/types';

/**
 * BullMQ Worker — 재계획 잡 처리
 *
 * BullMQ 기본 설정: attempts: 3, backoff: 2000ms (AppModule에서 설정)
 */
@Processor(REPLAN_QUEUE)
export class AlternativeProcessor extends WorkerHost {
  private readonly logger = new Logger(AlternativeProcessor.name);

  constructor(
    private readonly plannerService: PlannerService,
    private readonly realtimeGateway: RealtimeGateway,
  ) {
    super();
  }

  async process(job: Job<ReplanRequestDto>) {
    if (job.name !== REPLAN_JOB) return;

    const { tripId, trigger } = job.data;
    this.logger.log(`Processing replan job ${job.id} — trip: ${tripId}, trigger: ${trigger}`);

    try {
      const updatedItems = await this.plannerService.replan(job.data);

      this.realtimeGateway.pushReplanResult({
        jobId: String(job.id),
        tripId,
        status: 'completed',
        updatedItems,
        completedAt: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.error(`Replan job ${job.id} failed:`, err);
      this.realtimeGateway.pushReplanResult({
        jobId: String(job.id),
        tripId,
        status: 'failed',
        completedAt: new Date().toISOString(),
      });
      throw err; // BullMQ 재시도 트리거
    }
  }
}
