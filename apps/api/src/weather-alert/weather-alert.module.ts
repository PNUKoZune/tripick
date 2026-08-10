import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { upsertRepeatSchedules } from '../common/repeat-schedule';
import { ItineraryItemEntity } from '../itinerary/itinerary-item.entity';
import { TripEntity } from '../trips/trip.entity';
import { InboxModule } from '../inbox/inbox.module';
import { PlannerModule } from '../planner/planner.module';
import { TripMembersModule } from '../trip-members/trip-members.module';
import { WeatherAlertProcessor } from './weather-alert.processor';
import { WeatherAlertService } from './weather-alert.service';
import {
  SCHEDULE_REGISTER_TIMEOUT_MS,
  SCHEDULE_RETRY_BASE_MS,
  SCHEDULE_RETRY_MAX_MS,
  WEATHER_ALERT_CRON,
  WEATHER_ALERT_QUEUE,
  WEATHER_ALERT_SCAN_JOB,
} from './weather-alert.constants';

/**
 * 날씨 트리거 알림 모듈.
 *
 * 트리거가 Planner 와 다른(스케줄) 독립 도메인이라 별도 Module 로 둔다.
 * 재계획을 자동 실행하지 않고 사용자에게 변경 여부를 묻는 알림까지만 담당한다.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: WEATHER_ALERT_QUEUE }),
    TypeOrmModule.forFeature([TripEntity, ItineraryItemEntity]),
    PlannerModule,
    InboxModule,
    TripMembersModule,
  ],
  providers: [WeatherAlertService, WeatherAlertProcessor],
  exports: [WeatherAlertService],
})
export class WeatherAlertModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WeatherAlertModule.name);
  private registered = false;
  private retryTimer: NodeJS.Timeout | null = null;
  private destroyed = false;

  constructor(@InjectQueue(WEATHER_ALERT_QUEUE) private readonly queue: Queue) {}

  /** 반복 잡 등록 여부. 등록 전이면 날씨 스캔이 돌지 않으므로 헬스체크에서 확인할 수 있다. */
  get isScheduleRegistered(): boolean {
    return this.registered;
  }

  /**
   * 등록을 시작만 하고 기다리지 않는다.
   *
   * Redis 가 죽어 있으면 queue.add 는 던지지 않고 ioredis 오프라인 큐에 버퍼링되어
   * 영영 resolve 하지 않는다. Nest 는 onModuleInit 을 await 하므로 그대로 await 하면
   * 부팅이 통째로 멈춰 HTTP 리스닝조차 못 한다(try/catch 는 아예 실행되지 않는다).
   * 그래서 등록은 백그라운드로 돌리고, 실패하면 스스로 재시도한다.
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

  /**
   * 반복 스캔 잡을 등록한다. 스케줄러 ID 를 고정해 재기동·cron 변경에도 항목이 하나로 유지된다
   * (cron 을 바꿔도 옛 스케줄이 남던 문제는 `upsertRepeatSchedules` 주석 참고).
   * 발표 시각(02·05·08…)이 KST 기준이라 tz 도 그 안에서 KST 로 고정한다.
   *
   * 등록될 때까지 지수 백오프로 재시도해, Redis 가 늦게 떠도 스케줄이 결국 살아난다.
   */
  private async registerSchedule(attempt = 1): Promise<void> {
    if (this.destroyed) return;

    try {
      await upsertRepeatSchedules(
        this.queue,
        [{ name: WEATHER_ALERT_SCAN_JOB, cron: WEATHER_ALERT_CRON }],
        SCHEDULE_REGISTER_TIMEOUT_MS,
      );
      this.registered = true;
      this.logger.log(`날씨 스캔 반복 잡 등록 완료 (cron: ${WEATHER_ALERT_CRON})`);
    } catch (err) {
      // 백오프 상한까지 늘리며 계속 재시도 — 조용히 포기하면 날씨 알림이 영영 안 돈다.
      const delay = Math.min(
        SCHEDULE_RETRY_BASE_MS * 2 ** (attempt - 1),
        SCHEDULE_RETRY_MAX_MS,
      );
      this.logger.error(
        `날씨 스캔 반복 잡 등록 실패 (시도 ${attempt}) — ${Math.round(delay / 1000)}초 후 재시도:`,
        err,
      );
      this.scheduleRetry(attempt + 1, delay);
    }
  }

  private scheduleRetry(attempt: number, delay: number): void {
    if (this.destroyed) return;
    this.retryTimer = setTimeout(() => void this.registerSchedule(attempt), delay);
    // 재시도 타이머가 프로세스 종료를 붙잡지 않게 한다.
    this.retryTimer.unref();
  }
}
