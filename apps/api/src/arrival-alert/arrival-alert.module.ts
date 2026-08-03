import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { withTimeout } from '../common/with-timeout';
import { ItineraryItemEntity } from '../itinerary/itinerary-item.entity';
import { TripEntity } from '../trips/trip.entity';
import { InboxModule } from '../inbox/inbox.module';
import { TripMembersModule } from '../trip-members/trip-members.module';
import { ArrivalAlertProcessor } from './arrival-alert.processor';
import { ArrivalAlertService } from './arrival-alert.service';
import { LiveLocationModule } from './live-location.module';
import {
  ARRIVAL_ALERT_CRON,
  ARRIVAL_ALERT_QUEUE,
  ARRIVAL_ALERT_SCAN_JOB,
  SCHEDULE_REGISTER_TIMEOUT_MS,
  SCHEDULE_RETRY_BASE_MS,
  SCHEDULE_RETRY_MAX_MS,
} from './arrival-alert.constants';

/**
 * 미도착 감지 알림 모듈.
 *
 * 트리거가 Planner 와 다른(스케줄+위치) 독립 도메인이라 별도 Module 로 둔다
 * (WeatherAlert·CrowdAlert 와 동형). 재계획을 자동 실행하지 않고, 일정 시작 시각에 근처에
 * 없는 사용자에게 변경 여부를 묻는 알림까지만 담당한다. 위치 인제스트는 같은 폴더의
 * LiveLocationModule 이 맡는다 — 이탈 재계획도 그 위치를 쓰므로 알림 스캐너와 분리했다.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: ARRIVAL_ALERT_QUEUE }),
    TypeOrmModule.forFeature([TripEntity, ItineraryItemEntity]),
    InboxModule,
    TripMembersModule,
    LiveLocationModule,
  ],
  providers: [ArrivalAlertService, ArrivalAlertProcessor],
  exports: [ArrivalAlertService],
})
export class ArrivalAlertModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ArrivalAlertModule.name);
  private registered = false;
  private retryTimer: NodeJS.Timeout | null = null;
  private destroyed = false;

  constructor(@InjectQueue(ARRIVAL_ALERT_QUEUE) private readonly queue: Queue) {}

  /** 반복 잡 등록 여부. 등록 전이면 미도착 스캔이 돌지 않는다. */
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
          ARRIVAL_ALERT_SCAN_JOB,
          {},
          {
            // cron 을 KST 로 고정한다 — tz 미지정 시 서버 로컬(UTC 컨테이너면 KST 와 9시간 어긋남).
            repeat: { pattern: ARRIVAL_ALERT_CRON, tz: 'Asia/Seoul' },
            jobId: ARRIVAL_ALERT_SCAN_JOB,
            removeOnComplete: true,
            removeOnFail: 20,
          },
        ),
        SCHEDULE_REGISTER_TIMEOUT_MS,
      );
      this.registered = true;
      this.logger.log(`미도착 스캔 반복 잡 등록 완료 (cron: ${ARRIVAL_ALERT_CRON})`);
    } catch (err) {
      const delay = Math.min(SCHEDULE_RETRY_BASE_MS * 2 ** (attempt - 1), SCHEDULE_RETRY_MAX_MS);
      this.logger.error(
        `미도착 스캔 반복 잡 등록 실패 (시도 ${attempt}) — ${Math.round(delay / 1000)}초 후 재시도:`,
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
