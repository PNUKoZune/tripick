import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ReplanningController } from './replanning.controller';
import { ReplanningService } from './replanning.service';
import { REPLAN_QUEUE } from './replanning.constants';
import { TripMembersModule } from '../trip-members/trip-members.module';

@Module({
  imports: [BullModule.registerQueue({ name: REPLAN_QUEUE }), TripMembersModule],
  controllers: [ReplanningController],
  providers: [ReplanningService],
  exports: [ReplanningService],
})
export class ReplanningModule {}
