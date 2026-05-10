import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReplanningController } from './replanning.controller';
import { ReplanningService } from './replanning.service';
import { REPLAN_QUEUE } from './replanning.constants';
import { TripEntity } from '../trips/trip.entity';

@Module({
  imports: [BullModule.registerQueue({ name: REPLAN_QUEUE }), TypeOrmModule.forFeature([TripEntity])],
  controllers: [ReplanningController],
  providers: [ReplanningService],
  exports: [ReplanningService],
})
export class ReplanningModule {}
