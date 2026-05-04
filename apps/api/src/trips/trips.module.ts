import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TripEntity } from './trip.entity';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';
import { PlannerModule } from '../planner/planner.module';

@Module({
  imports: [TypeOrmModule.forFeature([TripEntity]), PlannerModule],
  controllers: [TripsController],
  providers: [TripsService],
  exports: [TripsService],
})
export class TripsModule {}
