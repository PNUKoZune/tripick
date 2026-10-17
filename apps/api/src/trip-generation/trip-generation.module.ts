import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlannerModule } from '../planner/planner.module';
import { TripEntity } from '../trips/trip.entity';
import { TRIP_GENERATION_QUEUE } from './trip-generation.constants';
import { TripGenerationProcessor } from './trip-generation.processor';
import { TripGenerationService } from './trip-generation.service';
import { GenerationRequestEntity } from './generation-request.entity';
import { GenerationLedgerService } from './generation-ledger.service';
import { TripGenerationQueuePolicy } from './trip-generation-queue-policy.service';
import { GenerationAdmissionFilter } from './generation-errors';

@Module({
  imports: [
    BullModule.registerQueue({ name: TRIP_GENERATION_QUEUE }),
    TypeOrmModule.forFeature([TripEntity, GenerationRequestEntity]),
    PlannerModule,
  ],
  providers: [
    TripGenerationService,
    TripGenerationProcessor,
    GenerationLedgerService,
    TripGenerationQueuePolicy,
    GenerationAdmissionFilter,
  ],
  exports: [TripGenerationService, GenerationLedgerService],
})
export class TripGenerationModule {}
