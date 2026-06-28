import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { REPLAN_QUEUE, REPLAN_JOB } from './replanning.constants';
import { TripMembersService } from '../trip-members/trip-members.service';
import type { ReplanRequestDto, ReplanJobDto } from '@tripick/types';

@Injectable()
export class ReplanningService {
  constructor(
    @InjectQueue(REPLAN_QUEUE) private readonly queue: Queue,
    private readonly tripMembersService: TripMembersService,
  ) {}

  async enqueue(userId: string, dto: ReplanRequestDto): Promise<ReplanJobDto> {
    // owner 뿐 아니라 accepted 멤버도 웨이팅/이탈 신고로 재계획을 트리거할 수 있다.
    const canAccess = await this.tripMembersService.canAccessTrip(dto.tripId, userId);
    if (!canAccess) {
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
