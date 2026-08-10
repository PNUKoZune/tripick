import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { APP_FILTER, APP_GUARD, DiscoveryModule } from '@nestjs/core';
// setup 서브패스로만 import 한다 — 메인 엔트리는 @nestjs/common 을 OpenTelemetry 패치 전에 끌어온다.
import { SentryModule, SentryGlobalFilter } from '@sentry/nestjs/setup';
import { ThrottlerModule } from '@nestjs/throttler';
import { SentryWorkerErrors } from './common/sentry/sentry-worker-errors';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { Redis } from 'ioredis';
import { redisConnection } from './common/redis.config';
import { HttpThrottlerGuard } from './common/guards/http-throttler.guard';
import { HealthController } from './health/health.controller';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TripsModule } from './trips/trips.module';
import { ItineraryModule } from './itinerary/itinerary.module';
import { PreferencesModule } from './preferences/preferences.module';
import { ReplanningModule } from './replanning/replanning.module';
import { RealtimeModule } from './realtime/realtime.module';
import { NotificationModule } from './notification/notification.module';
import { PlannerModule } from './planner/planner.module';
import { AlternativeModule } from './alternative/alternative.module';
import { WeatherAlertModule } from './weather-alert/weather-alert.module';
import { CrowdAlertModule } from './crowd-alert/crowd-alert.module';
import { ArrivalAlertModule } from './arrival-alert/arrival-alert.module';
import { NotificationSchedulerModule } from './notification-scheduler/notification-scheduler.module';
import { PreferenceAnalyzerModule } from './preference-analyzer/preference-analyzer.module';
import { MainPlannerModule } from './main-planner/main-planner.module';
import { ScheduleChangeModule } from './schedule-change/schedule-change.module';
import { TripMembersModule } from './trip-members/trip-members.module';
import { FriendsModule } from './friends/friends.module';
import { InboxModule } from './inbox/inbox.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    // 요청 트레이싱 인터셉터를 전역 등록. init 자체는 src/instrument.ts 에서 이미 끝났다.
    SentryModule.forRoot(),
    // SentryWorkerErrors 가 BullMQ 워커를 찾는 데 쓴다.
    DiscoveryModule,

    // 전역 기본 레이트리밋: 60초당 120 요청/IP. 개별 라우트는 @Throttle 로 더 빡빡하게.
    // 저장소는 Redis — 다중 인스턴스에서도 카운트를 공유한다 (BullMQ 와 같은 Redis).
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [{ ttl: 60_000, limit: 120 }],
        storage: new ThrottlerStorageRedisService(new Redis(redisConnection(config))),
      }),
    }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        // 개발은 지금까지처럼 synchronize 로 빠르게 반영하고,
        // 그 외(프로덕션·스테이징)는 마이그레이션만으로 스키마를 만든다.
        // 둘을 동시에 켜면 synchronize 가 마이그레이션 결과를 덮어쓸 수 있어 배타적으로 둔다.
        const isDevelopment = config.get('NODE_ENV') === 'development';

        return {
          type: 'postgres',
          url:
            config.get<string>('DATABASE_URL') ??
            'postgresql://tripick:tripick@localhost:5432/tripick',
          autoLoadEntities: true,
          synchronize: isDevelopment,
          logging: isDevelopment,
          // CLI 용 정의는 src/database/data-source.ts — 경로를 바꾸면 양쪽 다 고쳐야 한다.
          migrations: [join(__dirname, 'database', 'migrations', '*.{ts,js}')],
          migrationsTableName: 'migrations',
          // replica 1개 운영(§5-3)이라 부팅 시 마이그레이션이 동시 실행될 일이 없다.
          // 다중 인스턴스로 늘리면 배포 파이프라인의 별도 단계로 빼야 한다.
          migrationsRun: !isDevelopment,
        };
      },
    }),

    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: redisConnection(config),
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'fixed', delay: 2000 },
        },
      }),
    }),

    AuthModule,
    UsersModule,
    TripsModule,
    ItineraryModule,
    PreferencesModule,
    ReplanningModule,
    RealtimeModule,
    NotificationModule,
    PlannerModule,
    AlternativeModule,
    WeatherAlertModule,
    CrowdAlertModule,
    ArrivalAlertModule,
    NotificationSchedulerModule,
    PreferenceAnalyzerModule,
    MainPlannerModule,
    ScheduleChangeModule,
    TripMembersModule,
    FriendsModule,
    InboxModule,
  ],
  controllers: [HealthController],
  providers: [
    // 전역 가드로 모든 HTTP 라우트에 throttler 적용 (WS 는 통과)
    { provide: APP_GUARD, useClass: HttpThrottlerGuard },
    // 처리되지 않은 예외를 Sentry 로 보낸 뒤 Nest 기본 응답으로 넘긴다.
    // 커스텀 필터가 없어 그대로 얹을 수 있다 — 나중에 생기면 @SentryExceptionCaptured() 로 옮길 것.
    { provide: APP_FILTER, useClass: SentryGlobalFilter },
    SentryWorkerErrors,
  ],
})
export class AppModule {}
