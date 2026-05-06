import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlannerService } from './planner.service';
import { WeatherHelper } from './helpers/weather.helper';
import { RouteHelper } from './helpers/route.helper';
import { PreferenceHelper } from './helpers/preference.helper';
import { ScheduleConstraint } from './helpers/schedule.constraint';
import { ConstraintEngine } from './constraint/constraint.engine';
import { ItineraryModule } from '../itinerary/itinerary.module';
import { PreferencesModule } from '../preferences/preferences.module';
import { TripEntity } from '../trips/trip.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TripEntity]), ItineraryModule, PreferencesModule],
  providers: [
    PlannerService,
    WeatherHelper,
    RouteHelper,
    PreferenceHelper,
    ScheduleConstraint,
    ConstraintEngine,
  ],
  exports: [PlannerService],
})
export class PlannerModule {}
