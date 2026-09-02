import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlannerModule } from '../planner/planner.module';
import { TripEntity } from '../trips/trip.entity';
import { TRIP_GENERATION_QUEUE } from './trip-generation.constants';
import { TripGenerationProcessor } from './trip-generation.processor';
import { TripGenerationService } from './trip-generation.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: TRIP_GENERATION_QUEUE }),
    TypeOrmModule.forFeature([TripEntity]),
    PlannerModule,
  ],
  providers: [TripGenerationService, TripGenerationProcessor],
  exports: [TripGenerationService],
})
export class TripGenerationModule {}
