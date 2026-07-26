import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PlannerService } from '../planner/planner.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { InboxService } from '../inbox/inbox.service';
import { TripMembersService } from '../trip-members/trip-members.service';
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
    private readonly inboxService: InboxService,
    private readonly tripMembersService: TripMembersService,
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

      // 앱이 백그라운드/미접속이어도 결과를 받도록 인박스 + FCM 으로도 알린다.
      await this.notifyRecipients(tripId, 'completed', String(job.id), trigger);
    } catch (err) {
      this.logger.error(`Replan job ${job.id} failed:`, err);
      this.realtimeGateway.pushReplanResult({
        jobId: String(job.id),
        tripId,
        status: 'failed',
        completedAt: new Date().toISOString(),
      });

      // 재시도가 모두 소진된 최종 실패에서만 사용자에게 알린다(중간 재시도는 조용히).
      if (this.isFinalAttempt(job)) {
        await this.notifyRecipients(tripId, 'failed', String(job.id), trigger);
      }
      throw err; // BullMQ 재시도 트리거
    }
  }

  private isFinalAttempt(job: Job<ReplanRequestDto>): boolean {
    const maxAttempts = job.opts.attempts ?? 1;
    return job.attemptsMade + 1 >= maxAttempts;
  }

  /** 여행 수신자(owner + accepted 멤버) 전원에게 재계획 결과 알림. 실패해도 잡 자체엔 영향 없음. */
  private async notifyRecipients(
    tripId: string,
    status: 'completed' | 'failed',
    jobId: string,
    trigger: string,
  ): Promise<void> {
    try {
      const { tripTitle, userIds } = await this.tripMembersService.getNotificationTargets(tripId);
      if (userIds.length === 0) return;

      const label = tripTitle || '여행';
      const title = status === 'completed' ? '재계획 완료' : '재계획 실패';
      const body =
        status === 'completed'
          ? `${label} 일정이 업데이트됐어요. 확인해 보세요.`
          : `${label} 재계획에 실패했어요. 잠시 후 다시 시도해 주세요.`;

      // 트리거와 무관하게 항상 replan_ready — 이건 "재계획 결과" 알림이지 새 제안이 아니다.
      // 트리거별 카테고리(weather_alert 등)로 보내면 (1) 인박스가 이 결과 카드에도 '일정 변경'
      // 재계획 액션을 붙여 완료 → 재계획 → 완료 루프가 되고, (2) 해당 알림 토글을 끈 사용자는
      // 자기가 직접 요청한 재계획의 완료·실패조차 못 받는다.
      await Promise.all(
        userIds.map((userId) =>
          this.inboxService.create({
            userId,
            category: 'replan_ready',
            title,
            body,
            payload: { tripId, jobId, trigger, status },
          }),
        ),
      );
    } catch (err) {
      this.logger.error(`Failed to notify replan recipients (trip ${tripId}):`, err);
    }
  }
}
