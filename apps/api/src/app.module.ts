import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { Redis } from 'ioredis';
import { HttpThrottlerGuard } from './common/guards/http-throttler.guard';
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
import { PreferenceAnalyzerModule } from './preference-analyzer/preference-analyzer.module';
import { MainPlannerModule } from './main-planner/main-planner.module';
import { TripMembersModule } from './trip-members/trip-members.module';
import { FriendsModule } from './friends/friends.module';
import { InboxModule } from './inbox/inbox.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    // 전역 기본 레이트리밋: 60초당 120 요청/IP. 개별 라우트는 @Throttle 로 더 빡빡하게.
    // 저장소는 Redis — 다중 인스턴스에서도 카운트를 공유한다 (BullMQ 와 같은 Redis).
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [{ ttl: 60_000, limit: 120 }],
        storage: new ThrottlerStorageRedisService(
          new Redis({
            host: config.get<string>('REDIS_HOST', 'localhost'),
            port: config.get<number>('REDIS_PORT', 6379),
          }),
        ),
      }),
    }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url:
          config.get<string>('DATABASE_URL') ??
          'postgresql://tripick:tripick@localhost:5432/tripick',
        autoLoadEntities: true,
        synchronize: config.get('NODE_ENV') === 'development',
        logging: config.get('NODE_ENV') === 'development',
      }),
    }),

    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
        },
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
    PreferenceAnalyzerModule,
    MainPlannerModule,
    TripMembersModule,
    FriendsModule,
    InboxModule,
  ],
  providers: [
    // 전역 가드로 모든 HTTP 라우트에 throttler 적용 (WS 는 통과)
    { provide: APP_GUARD, useClass: HttpThrottlerGuard },
  ],
})
export class AppModule {}
