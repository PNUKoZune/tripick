import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ItineraryItemEntity } from '../itinerary/itinerary-item.entity';
import { TripEntity } from '../trips/trip.entity';
import { ArrivalAlertModule } from '../arrival-alert/arrival-alert.module';
import { LiveLocationModule } from '../arrival-alert/live-location.module';
import { InboxModule } from '../inbox/inbox.module';
import { InboxService } from '../inbox/inbox.service';
import { TripMembersModule } from '../trip-members/trip-members.module';
import { TripMembersService } from '../trip-members/trip-members.service';
import { WeatherAlertService } from '../weather-alert/weather-alert.service';
import { CrowdAlertService } from '../crowd-alert/crowd-alert.service';
import type { WeatherHelper } from '../planner/helpers/weather.helper';
import type { TatsCnctrRateService } from '../planner/retrieval/tats-cnctr-rate.service';
import { DemoConcentrationSource, DemoForecastSource } from './demo-alert-sources';
import { DemoConsoleController } from './demo-console.controller';
import { DemoConsoleGuard, demoConsoleEmails } from './demo-console.guard';
import { DemoConsoleService } from './demo-console.service';
import {
  DEMO_CONSOLE_ENABLED_ENV,
  DEMO_CONSOLE_EMAILS_ENV,
  DEMO_CROWD_ALERT,
  DEMO_WEATHER_ALERT,
} from './demo-console.constants';

/** 시연 콘솔을 켤지 — AppModule 이 import 목록을 정할 때 읽으므로 ConfigService 가 아직 없다. */
export function isDemoConsoleEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[DEMO_CONSOLE_ENABLED_ENV] === 'true';
}

/**
 * 시연 콘솔 모듈 (발표 보조 도구, 기본 비활성).
 *
 * 켜졌을 때만 AppModule 에 붙는다 — 플래그가 꺼져 있으면 라우트 자체가 존재하지 않아
 * 가드를 뚫을 표면도 없다. 안에서 만드는 WeatherAlert·CrowdAlert 인스턴스는 정기 스캔이
 * 쓰는 것과 **같은 클래스**이고, 바깥 데이터 대역(기상청·KTO)만 시연용 소스로 바꿔 끼운다.
 * 그래서 임계 판정·중복 억제·인박스·FCM 은 운영 코드 그대로다.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([TripEntity, ItineraryItemEntity]),
    ArrivalAlertModule,
    LiveLocationModule,
    InboxModule,
    TripMembersModule,
  ],
  controllers: [DemoConsoleController],
  providers: [
    DemoConsoleService,
    DemoConsoleGuard,
    DemoForecastSource,
    DemoConcentrationSource,
    {
      provide: DEMO_WEATHER_ALERT,
      inject: [
        getRepositoryToken(TripEntity),
        getRepositoryToken(ItineraryItemEntity),
        DemoForecastSource,
        InboxService,
        TripMembersService,
        ConfigService,
      ],
      useFactory: (
        tripsRepo: Repository<TripEntity>,
        itemsRepo: Repository<ItineraryItemEntity>,
        forecast: DemoForecastSource,
        inbox: InboxService,
        members: TripMembersService,
        config: ConfigService,
      ) =>
        new WeatherAlertService(
          tripsRepo,
          itemsRepo,
          forecast as unknown as WeatherHelper,
          inbox,
          members,
          config,
        ),
    },
    {
      provide: DEMO_CROWD_ALERT,
      inject: [
        getRepositoryToken(TripEntity),
        getRepositoryToken(ItineraryItemEntity),
        DemoConcentrationSource,
        InboxService,
        TripMembersService,
        ConfigService,
      ],
      useFactory: (
        tripsRepo: Repository<TripEntity>,
        itemsRepo: Repository<ItineraryItemEntity>,
        concentration: DemoConcentrationSource,
        inbox: InboxService,
        members: TripMembersService,
        config: ConfigService,
      ) =>
        new CrowdAlertService(
          tripsRepo,
          itemsRepo,
          concentration as unknown as TatsCnctrRateService,
          inbox,
          members,
          config,
        ),
    },
  ],
})
export class DemoConsoleModule implements OnModuleInit {
  private readonly logger = new Logger(DemoConsoleModule.name);

  constructor(private readonly config: ConfigService) {}

  /** 켜져 있다는 사실을 부팅 로그에 남긴다 — 끄는 걸 잊은 환경을 로그에서 찾을 수 있게. */
  onModuleInit(): void {
    const allowed = demoConsoleEmails(this.config);
    this.logger.warn(
      `시연 콘솔(/demo) 활성 — 허용 계정 ${allowed.length > 0 ? allowed.join(', ') : `(미설정: ${DEMO_CONSOLE_EMAILS_ENV})`}`,
    );
  }
}
