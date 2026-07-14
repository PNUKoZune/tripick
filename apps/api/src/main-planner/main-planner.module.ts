import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FriendsModule } from '../friends/friends.module';
import { InboxModule } from '../inbox/inbox.module';
import { ItineraryItemEntity } from '../itinerary/itinerary-item.entity';
import { PreferencesModule } from '../preferences/preferences.module';
import { TripMembersModule } from '../trip-members/trip-members.module';
import { TripEntity } from '../trips/trip.entity';
import { TripsModule } from '../trips/trips.module';
import { DestinationsService } from './destinations.service';
import { PlannerModule } from '../planner/planner.module';
import { MainPlannerController } from './main-planner.controller';
import { SharedItineraryController } from './shared-itinerary.controller';
import { MainPlannerService } from './main-planner.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TripEntity, ItineraryItemEntity]),
    TripsModule,
    TripMembersModule,
    FriendsModule,
    PreferencesModule,
    InboxModule,
    // 기본 추천 대안에 CRAG/임베딩 검색(PlaceRetrievalService)과 Kakao 직검색을 쓴다.
    // WeatherHelper 도 PlannerModule 에서 export 된 단일 인스턴스를 공유한다(Redis 커넥션 1개).
    PlannerModule,
  ],
  controllers: [MainPlannerController, SharedItineraryController],
  providers: [MainPlannerService, DestinationsService],
})
export class MainPlannerModule {}
