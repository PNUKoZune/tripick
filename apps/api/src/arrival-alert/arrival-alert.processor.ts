import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ArrivalAlertService } from './arrival-alert.service';
import { ARRIVAL_ALERT_QUEUE, ARRIVAL_ALERT_SCAN_JOB } from './arrival-alert.constants';

/**
 * 미도착 스캔 반복 잡 Worker.
 *
 * BullMQ repeatable 잡이라 다중 인스턴스에서도 한 번만 실행된다
 * (@nestjs/schedule 은 인스턴스마다 돌아 중복 알림이 되므로 쓰지 않았다).
 */
@Processor(ARRIVAL_ALERT_QUEUE)
export class ArrivalAlertProcessor extends WorkerHost {
  private readonly logger = new Logger(ArrivalAlertProcessor.name);

  constructor(private readonly arrivalAlertService: ArrivalAlertService) {
    super();
  }

  async process(job: Job): Promise<{ alerted: number }> {
    if (job.name !== ARRIVAL_ALERT_SCAN_JOB) return { alerted: 0 };

    const alerted = await this.arrivalAlertService.scanDueItems();
    return { alerted };
  }
}
