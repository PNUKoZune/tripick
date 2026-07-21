import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { withTimeout } from '../common/with-timeout';
import { TripEntity } from '../trips/trip.entity';
import { NotificationEntity } from '../inbox/notification.entity';
import { InboxModule } from '../inbox/inbox.module';
import { TripMembersModule } from '../trip-members/trip-members.module';
import { NotificationArchiveService } from './notification-archive.service';
import { NotificationSchedulerProcessor } from './notification-scheduler.processor';
import { TripReminderService } from './trip-reminder.service';
import {
  NOTIFICATION_ARCHIVE_CRON,
  NOTIFICATION_ARCHIVE_JOB,
  NOTIFICATION_SCHEDULER_QUEUE,
  SCHEDULE_REGISTER_TIMEOUT_MS,
  SCHEDULE_RETRY_BASE_MS,
  SCHEDULE_RETRY_MAX_MS,
  TRIP_REMINDER_CRON,
  TRIP_REMINDER_SCAN_JOB,
} from './notification-scheduler.constants';

/** 반복 등록할 잡 1건의 정의. */
interface RepeatableJob {
  name: string;
  cron: string;
}

/**
 * 알림 스케줄러 모듈.
 *
 * 트리거가 스케줄(시간)인 독립 도메인 두 개(트립 리마인더 발송 + 오래된 알림 정리)를
 * 한 큐·한 Worker 위에 얹는다. 둘 다 자동 동작은 없고 인박스 알림 발송/정리만 한다.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: NOTIFICATION_SCHEDULER_QUEUE }),
    TypeOrmModule.forFeature([TripEntity, NotificationEntity]),
    InboxModule,
    TripMembersModule,
  ],
  providers: [TripReminderService, NotificationArchiveService, NotificationSchedulerProcessor],
  exports: [TripReminderService, NotificationArchiveService],
})
export class NotificationSchedulerModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationSchedulerModule.name);
  private registered = false;
  private retryTimer: NodeJS.Timeout | null = null;
  private destroyed = false;

  private readonly jobs: RepeatableJob[] = [
    { name: TRIP_REMINDER_SCAN_JOB, cron: TRIP_REMINDER_CRON },
    { name: NOTIFICATION_ARCHIVE_JOB, cron: NOTIFICATION_ARCHIVE_CRON },
  ];

  constructor(@InjectQueue(NOTIFICATION_SCHEDULER_QUEUE) private readonly queue: Queue) {}

  /** 반복 잡 등록 여부. 등록 전이면 스케줄이 돌지 않으므로 헬스체크에서 확인할 수 있다. */
  get isScheduleRegistered(): boolean {
    return this.registered;
  }

  /**
   * 등록을 시작만 하고 기다리지 않는다. Redis 가 죽어 있으면 queue.add 는 던지지 않고
   * ioredis 오프라인 큐에 버퍼링되어 영영 resolve 하지 않아, await 하면 부팅이 통째로
   * 멈춘다. 그래서 백그라운드로 돌리고 실패하면 스스로 재시도한다.
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
   * 반복 잡들을 등록한다. jobId 를 고정해 재기동마다 중복 등록되지 않게 한다.
   * cron 을 바꾸면 BullMQ 가 같은 key 의 스케줄을 갱신한다.
   * 하나라도 실패하면 지수 백오프로 전체를 재시도해, Redis 가 늦게 떠도 결국 살아난다.
   */
  private async registerSchedule(attempt = 1): Promise<void> {
    if (this.destroyed) return;

    try {
      for (const job of this.jobs) {
        await withTimeout(
          this.queue.add(
            job.name,
            {},
            {
              // cron 을 KST 로 고정한다 — tz 미지정 시 서버 로컬(UTC 컨테이너면 9시간 어긋남).
              repeat: { pattern: job.cron, tz: 'Asia/Seoul' },
              jobId: job.name,
              removeOnComplete: true,
              removeOnFail: 20,
            },
          ),
          SCHEDULE_REGISTER_TIMEOUT_MS,
        );
      }
      this.registered = true;
      this.logger.log(
        `알림 스케줄러 반복 잡 등록 완료 (리마인더: ${TRIP_REMINDER_CRON}, 아카이브: ${NOTIFICATION_ARCHIVE_CRON})`,
      );
    } catch (err) {
      const delay = Math.min(SCHEDULE_RETRY_BASE_MS * 2 ** (attempt - 1), SCHEDULE_RETRY_MAX_MS);
      this.logger.error(
        `알림 스케줄러 반복 잡 등록 실패 (시도 ${attempt}) — ${Math.round(delay / 1000)}초 후 재시도:`,
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
