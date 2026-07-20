import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { CrowdAlertService } from './crowd-alert.service';
import { CROWD_ALERT_QUEUE, CROWD_ALERT_SCAN_JOB } from './crowd-alert.constants';

/**
 * 혼잡 스캔 반복 잡 Worker.
 *
 * BullMQ repeatable 잡이라 다중 인스턴스에서도 한 번만 실행된다
 * (@nestjs/schedule 은 인스턴스마다 돌아 중복 알림이 되므로 쓰지 않았다).
 */
@Processor(CROWD_ALERT_QUEUE)
export class CrowdAlertProcessor extends WorkerHost {
  private readonly logger = new Logger(CrowdAlertProcessor.name);

  constructor(private readonly crowdAlertService: CrowdAlertService) {
    super();
  }

  async process(job: Job): Promise<{ alerted: number }> {
    if (job.name !== CROWD_ALERT_SCAN_JOB) return { alerted: 0 };

    const alerted = await this.crowdAlertService.scanUpcomingTrips();
    this.logger.log(`혼잡 스캔 잡 ${job.id} 완료 — 알림 ${alerted}건`);
    return { alerted };
  }
}
