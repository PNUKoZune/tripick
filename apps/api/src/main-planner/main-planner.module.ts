import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FriendsModule } from '../friends/friends.module';
import { ItineraryItemEntity } from '../itinerary/itinerary-item.entity';
import { PreferencesModule } from '../preferences/preferences.module';
import { TripMembersModule } from '../trip-members/trip-members.module';
import { TripEntity } from '../trips/trip.entity';
import { TripsModule } from '../trips/trips.module';
import { MainPlannerController } from './main-planner.controller';
import { MainPlannerService } from './main-planner.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TripEntity, ItineraryItemEntity]),
    TripsModule,
    TripMembersModule,
    FriendsModule,
    PreferencesModule,
  ],
  controllers: [MainPlannerController],
  providers: [MainPlannerService],
})
export class MainPlannerModule {}
