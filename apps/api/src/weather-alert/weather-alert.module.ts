import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { ItineraryItemEntity } from '../itinerary/itinerary-item.entity';
import { TripEntity } from '../trips/trip.entity';
import { InboxModule } from '../inbox/inbox.module';
import { PlannerModule } from '../planner/planner.module';
import { TripMembersModule } from '../trip-members/trip-members.module';
import { WeatherAlertProcessor } from './weather-alert.processor';
import { WeatherAlertService } from './weather-alert.service';
import {
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
export class WeatherAlertModule implements OnModuleInit {
  private readonly logger = new Logger(WeatherAlertModule.name);

  constructor(@InjectQueue(WEATHER_ALERT_QUEUE) private readonly queue: Queue) {}

  /**
   * 반복 스캔 잡을 등록한다. jobId 를 고정해 재기동마다 중복 등록되지 않게 한다.
   * cron 을 바꾸면 BullMQ 가 같은 key 의 스케줄을 갱신한다.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.queue.add(
        WEATHER_ALERT_SCAN_JOB,
        {},
        {
          repeat: { pattern: WEATHER_ALERT_CRON },
          jobId: WEATHER_ALERT_SCAN_JOB,
          removeOnComplete: true,
          removeOnFail: 20,
        },
      );
      this.logger.log(`날씨 스캔 반복 잡 등록 완료 (cron: ${WEATHER_ALERT_CRON})`);
    } catch (err) {
      // 스케줄 등록 실패가 API 부팅을 막지는 않게 한다.
      this.logger.error('날씨 스캔 반복 잡 등록 실패:', err);
    }
  }
}
