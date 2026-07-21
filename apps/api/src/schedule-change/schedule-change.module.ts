import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InboxModule } from '../inbox/inbox.module';
import { MainPlannerModule } from '../main-planner/main-planner.module';
import { ReplanningModule } from '../replanning/replanning.module';
import { TripsModule } from '../trips/trips.module';
import { UsersModule } from '../users/users.module';
import { ScheduleChangeController } from './schedule-change.controller';
import { ScheduleChangeProposalEntity } from './schedule-change.entity';
import { ScheduleChangeService } from './schedule-change.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ScheduleChangeProposalEntity]),
    TripsModule,
    MainPlannerModule,
    ReplanningModule,
    UsersModule,
    InboxModule,
  ],
  controllers: [ScheduleChangeController],
  providers: [ScheduleChangeService],
})
export class ScheduleChangeModule {}
