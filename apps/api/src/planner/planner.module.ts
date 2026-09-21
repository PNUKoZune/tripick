import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlannerAgentService } from './agent/planner-agent.service';
import { PlannerService } from './planner.service';
import { WeatherHelper } from './helpers/weather.helper';
import { RouteHelper } from './helpers/route.helper';
import { ScheduleConstraint } from './helpers/schedule.constraint';
import { ConstraintEngine } from './constraint/constraint.engine';
import { CragEvaluatorService } from './retrieval/crag-evaluator.service';
import { DestinationAnchorService } from './retrieval/destination-anchor.service';
import { IngestCursorRepository } from './retrieval/ingest-cursor.repository';
import { KakaoLocalService } from './retrieval/kakao-local.service';
import { NaverSearchService } from './retrieval/naver-search.service';
import { PlaceEmbeddingRepository } from './retrieval/place-embedding.repository';
import { PlaceRetrievalService } from './retrieval/place-retrieval.service';
import { TourApiService } from './retrieval/tour-api.service';
import { TatsCnctrRateService } from './retrieval/tats-cnctr-rate.service';
import { PlaceIngestionService } from './retrieval/place-ingestion.service';
import { PopularPlaceService } from './retrieval/popular-place.service';
import { KeywordPlaceService } from './retrieval/keyword-place.service';
import { EmbeddingModule } from '../embedding/embedding.module';
import { ItineraryModule } from '../itinerary/itinerary.module';
import { PreferencesModule } from '../preferences/preferences.module';
import { TripEntity } from '../trips/trip.entity';
import { TripDayEntity } from '../trips/trip-day.entity';
import { TripMemberEntity } from '../trip-members/trip-member.entity';
import { GroupPreferenceService } from './retrieval/group-preference.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TripEntity, TripDayEntity, TripMemberEntity]),
    ItineraryModule,
    PreferencesModule,
    EmbeddingModule,
  ],
  providers: [
    PlannerService,
    PlannerAgentService,
    WeatherHelper,
    RouteHelper,
    ScheduleConstraint,
    ConstraintEngine,
    PlaceEmbeddingRepository,
    IngestCursorRepository,
    KakaoLocalService,
    NaverSearchService,
    CragEvaluatorService,
    DestinationAnchorService,
    PlaceRetrievalService,
    GroupPreferenceService,
    TourApiService,
    TatsCnctrRateService,
    PopularPlaceService,
    KeywordPlaceService,
    PlaceIngestionService,
  ],
  exports: [
    PlannerService,
    PlaceRetrievalService,
    PlaceEmbeddingRepository,
    KakaoLocalService,
    TourApiService,
    TatsCnctrRateService,
    NaverSearchService,
    RouteHelper,
    WeatherHelper,
    GroupPreferenceService,
  ],
})
export class PlannerModule {}
