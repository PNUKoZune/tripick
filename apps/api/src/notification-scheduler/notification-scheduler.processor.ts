import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { TripReminderService } from './trip-reminder.service';
import { NotificationArchiveService } from './notification-archive.service';
import {
  NOTIFICATION_ARCHIVE_JOB,
  NOTIFICATION_SCHEDULER_QUEUE,
  TRIP_REMINDER_SCAN_JOB,
} from './notification-scheduler.constants';

/**
 * 알림 스케줄러 Worker. 한 큐에 등록된 두 반복 잡을 job.name 으로 분기한다.
 *
 * BullMQ repeatable 잡이라 다중 인스턴스에서도 한 번만 실행된다
 * (@nestjs/schedule 은 인스턴스마다 돌아 중복 실행되므로 쓰지 않았다).
 */
@Processor(NOTIFICATION_SCHEDULER_QUEUE)
export class NotificationSchedulerProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationSchedulerProcessor.name);

  constructor(
    private readonly tripReminderService: TripReminderService,
    private readonly notificationArchiveService: NotificationArchiveService,
  ) {
    super();
  }

  async process(job: Job): Promise<{ processed: number }> {
    if (job.name === TRIP_REMINDER_SCAN_JOB) {
      const alerted = await this.tripReminderService.scanUpcomingTrips();
      this.logger.log(`리마인더 스캔 잡 ${job.id} 완료 — 알림 ${alerted}건`);
      return { processed: alerted };
    }
    if (job.name === NOTIFICATION_ARCHIVE_JOB) {
      const removed = await this.notificationArchiveService.archiveStale();
      this.logger.log(`알림 아카이브 잡 ${job.id} 완료 — 삭제 ${removed}건`);
      return { processed: removed };
    }
    return { processed: 0 };
  }
}
