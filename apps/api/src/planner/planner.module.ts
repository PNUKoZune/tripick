import { Module } from '@nestjs/common';
import { PlannerService } from './planner.service';
import { WeatherHelper } from './helpers/weather.helper';
import { RouteHelper } from './helpers/route.helper';
import { PreferenceHelper } from './helpers/preference.helper';
import { ScheduleConstraint } from './helpers/schedule.constraint';
import { ConstraintEngine } from './constraint/constraint.engine';
import { ItineraryModule } from '../itinerary/itinerary.module';
import { PreferencesModule } from '../preferences/preferences.module';

@Module({
  imports: [ItineraryModule, PreferencesModule],
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
