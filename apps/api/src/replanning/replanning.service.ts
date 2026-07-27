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
    // owner 뿐 아니라 accepted 멤버도 이탈 신고·수동 요청으로 재계획을 트리거할 수 있다.
    const canAccess = await this.tripMembersService.canAccessTrip(dto.tripId, userId);
    if (!canAccess) {
      throw new ForbiddenException();
    }

    // P3-12: 같은 여행·트리거·대상 일차의 재계획을 짧은 시간 창(10초) 안에서 dedup.
    // BullMQ 는 동일 jobId 를 무시하므로 연속 클릭/중복 제출이 하나의 잡으로 합쳐진다.
    // 대상 일차를 키에 넣지 않으면 "1일차 → 곧바로 2일차" 재계획이 하나로 합쳐져 버려진다.
    const bucket = Math.floor(Date.now() / 10_000);
    const scope = dto.targetDays?.length ? [...dto.targetDays].sort((a, b) => a - b).join('.') : 'all';
    const job = await this.queue.add(REPLAN_JOB, dto, {
      jobId: `${dto.tripId}-${dto.trigger}-${scope}-${bucket}`,
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
