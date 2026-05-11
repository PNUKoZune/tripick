import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
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
import { PreferenceAnalyzerModule } from './preference-analyzer/preference-analyzer.module';
import { MainPlannerModule } from './main-planner/main-planner.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL') ?? 'postgresql://tripick:tripick@localhost:5432/tripick',
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
    PreferenceAnalyzerModule,
    MainPlannerModule,
  ],
})
export class AppModule {}
