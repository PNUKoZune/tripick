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

    // P3-12: 같은 여행·트리거의 재계획을 짧은 시간 창(10초) 안에서 dedup.
    // BullMQ 는 동일 jobId 를 무시하므로 연속 클릭/중복 제출이 하나의 잡으로 합쳐진다.
    const bucket = Math.floor(Date.now() / 10_000);
    const job = await this.queue.add(REPLAN_JOB, dto, {
      jobId: `${dto.tripId}-${dto.trigger}-${bucket}`,
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
