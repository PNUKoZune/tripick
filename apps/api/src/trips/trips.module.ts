import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TripEntity } from './trip.entity';
import { TripDayEntity } from './trip-day.entity';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';
import { TripMemberEntity } from '../trip-members/trip-member.entity';
import { TripGenerationModule } from '../trip-generation/trip-generation.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TripEntity, TripDayEntity, TripMemberEntity]),
    TripGenerationModule,
  ],
  controllers: [TripsController],
  providers: [TripsService],
  exports: [TripsService],
})
export class TripsModule {}
