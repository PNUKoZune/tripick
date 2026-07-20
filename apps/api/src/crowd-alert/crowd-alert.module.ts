import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { withTimeout } from '../common/with-timeout';
import { ItineraryItemEntity } from '../itinerary/itinerary-item.entity';
import { TripEntity } from '../trips/trip.entity';
import { InboxModule } from '../inbox/inbox.module';
import { PlannerModule } from '../planner/planner.module';
import { TripMembersModule } from '../trip-members/trip-members.module';
import { CrowdAlertProcessor } from './crowd-alert.processor';
import { CrowdAlertService } from './crowd-alert.service';
import {
  CROWD_ALERT_CRON,
  CROWD_ALERT_QUEUE,
  CROWD_ALERT_SCAN_JOB,
  SCHEDULE_REGISTER_TIMEOUT_MS,
  SCHEDULE_RETRY_BASE_MS,
  SCHEDULE_RETRY_MAX_MS,
} from './crowd-alert.constants';

/**
 * 관광지 집중률(혼잡도) 트리거 알림 모듈.
 *
 * 트리거가 Planner 와 다른(스케줄) 독립 도메인이라 별도 Module 로 둔다(WeatherAlertModule 과 동형).
 * 재계획을 자동 실행하지 않고 사용자에게 변경 여부를 묻는 추천 알림까지만 담당한다.
 * TatsCnctrRateService 는 PlannerModule 이 제공/노출한다.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: CROWD_ALERT_QUEUE }),
    TypeOrmModule.forFeature([TripEntity, ItineraryItemEntity]),
    PlannerModule,
    InboxModule,
    TripMembersModule,
  ],
  providers: [CrowdAlertService, CrowdAlertProcessor],
  exports: [CrowdAlertService],
})
export class CrowdAlertModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CrowdAlertModule.name);
  private registered = false;
  private retryTimer: NodeJS.Timeout | null = null;
  private destroyed = false;

  constructor(@InjectQueue(CROWD_ALERT_QUEUE) private readonly queue: Queue) {}

  /** 반복 잡 등록 여부. 등록 전이면 혼잡 스캔이 돌지 않는다. */
  get isScheduleRegistered(): boolean {
    return this.registered;
  }

  /**
   * 등록을 시작만 하고 기다리지 않는다. Redis 가 죽어 있으면 queue.add 가 오프라인 큐에
   * 버퍼링되어 영영 resolve 하지 않아, await 하면 부팅이 멈추기 때문이다.
   */
  onModuleInit(): void {
    void this.registerSchedule();
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  /** 반복 스캔 잡 등록. jobId 고정으로 재기동마다 중복 등록되지 않게 하고, 실패 시 지수 백오프 재시도. */
  private async registerSchedule(attempt = 1): Promise<void> {
    if (this.destroyed) return;

    try {
      await withTimeout(
        this.queue.add(
          CROWD_ALERT_SCAN_JOB,
          {},
          {
            repeat: { pattern: CROWD_ALERT_CRON },
            jobId: CROWD_ALERT_SCAN_JOB,
            removeOnComplete: true,
            removeOnFail: 20,
          },
        ),
        SCHEDULE_REGISTER_TIMEOUT_MS,
      );
      this.registered = true;
      this.logger.log(`혼잡 스캔 반복 잡 등록 완료 (cron: ${CROWD_ALERT_CRON})`);
    } catch (err) {
      const delay = Math.min(SCHEDULE_RETRY_BASE_MS * 2 ** (attempt - 1), SCHEDULE_RETRY_MAX_MS);
      this.logger.error(
        `혼잡 스캔 반복 잡 등록 실패 (시도 ${attempt}) — ${Math.round(delay / 1000)}초 후 재시도:`,
        err,
      );
      this.scheduleRetry(attempt + 1, delay);
    }
  }

  private scheduleRetry(attempt: number, delay: number): void {
    if (this.destroyed) return;
    this.retryTimer = setTimeout(() => void this.registerSchedule(attempt), delay);
    this.retryTimer.unref();
  }
}
