import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlannerAgentService } from './agent/planner-agent.service';
import { PlannerService } from './planner.service';
import { WeatherHelper } from './helpers/weather.helper';
import { RouteHelper } from './helpers/route.helper';
import { ScheduleConstraint } from './helpers/schedule.constraint';
import { ConstraintEngine } from './constraint/constraint.engine';
import { CragEvaluatorService } from './retrieval/crag-evaluator.service';
import { KakaoLocalService } from './retrieval/kakao-local.service';
import { PlaceEmbeddingRepository } from './retrieval/place-embedding.repository';
import { PlaceRetrievalService } from './retrieval/place-retrieval.service';
import { TextEmbeddingService } from './retrieval/text-embedding.service';
import { ItineraryModule } from '../itinerary/itinerary.module';
import { PreferencesModule } from '../preferences/preferences.module';
import { TripEntity } from '../trips/trip.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TripEntity]), ItineraryModule, PreferencesModule],
  providers: [
    PlannerService,
    PlannerAgentService,
    WeatherHelper,
    RouteHelper,
    ScheduleConstraint,
    ConstraintEngine,
    TextEmbeddingService,
    PlaceEmbeddingRepository,
    KakaoLocalService,
    CragEvaluatorService,
    PlaceRetrievalService,
  ],
  exports: [PlannerService],
})
export class PlannerModule {}
