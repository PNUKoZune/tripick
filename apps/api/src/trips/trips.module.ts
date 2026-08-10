import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TripEntity } from './trip.entity';
import { TripDayEntity } from './trip-day.entity';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';
import { PlannerModule } from '../planner/planner.module';
import { TripMemberEntity } from '../trip-members/trip-member.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([TripEntity, TripDayEntity, TripMemberEntity]),
    PlannerModule,
  ],
  controllers: [TripsController],
  providers: [TripsService],
  exports: [TripsService],
})
export class TripsModule {}
