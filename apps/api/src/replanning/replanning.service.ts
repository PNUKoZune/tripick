import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { REPLAN_QUEUE, REPLAN_JOB } from './replanning.constants';
import type { ReplanRequestDto, ReplanJobDto } from '@tripick/types';

@Injectable()
export class ReplanningService {
  constructor(@InjectQueue(REPLAN_QUEUE) private readonly queue: Queue) {}

  async enqueue(dto: ReplanRequestDto): Promise<ReplanJobDto> {
    const job = await this.queue.add(REPLAN_JOB, dto, {
      jobId: `${dto.tripId}-${Date.now()}`,
    });
    return {
      jobId: String(job.id),
      tripId: dto.tripId,
      trigger: dto.trigger,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
  }
}
