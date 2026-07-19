import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { WeatherAlertService } from './weather-alert.service';
import { WEATHER_ALERT_QUEUE, WEATHER_ALERT_SCAN_JOB } from './weather-alert.constants';

/**
 * 날씨 스캔 반복 잡 Worker.
 *
 * BullMQ repeatable 잡이라 다중 인스턴스에서도 한 번만 실행된다
 * (@nestjs/schedule 은 인스턴스마다 돌아 중복 알림이 되므로 쓰지 않았다).
 */
@Processor(WEATHER_ALERT_QUEUE)
export class WeatherAlertProcessor extends WorkerHost {
  private readonly logger = new Logger(WeatherAlertProcessor.name);

  constructor(private readonly weatherAlertService: WeatherAlertService) {
    super();
  }

  async process(job: Job): Promise<{ alerted: number }> {
    if (job.name !== WEATHER_ALERT_SCAN_JOB) return { alerted: 0 };

    const alerted = await this.weatherAlertService.scanUpcomingTrips();
    this.logger.log(`날씨 스캔 잡 ${job.id} 완료 — 알림 ${alerted}건`);
    return { alerted };
  }
}
