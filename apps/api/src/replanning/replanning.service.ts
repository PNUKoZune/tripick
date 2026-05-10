import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { REPLAN_QUEUE, REPLAN_JOB } from './replanning.constants';
import { TripEntity } from '../trips/trip.entity';
import type { ReplanRequestDto, ReplanJobDto } from '@tripick/types';

@Injectable()
export class ReplanningService {
  constructor(
    @InjectQueue(REPLAN_QUEUE) private readonly queue: Queue,
    @InjectRepository(TripEntity) private readonly tripsRepo: Repository<TripEntity>,
  ) {}

  async enqueue(userId: string, dto: ReplanRequestDto): Promise<ReplanJobDto> {
    const trip = await this.tripsRepo.findOneBy({ id: dto.tripId });
    if (!trip) {
      throw new NotFoundException(`Trip ${dto.tripId} not found`);
    }
    if (trip.userId !== userId) {
      throw new ForbiddenException();
    }

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
