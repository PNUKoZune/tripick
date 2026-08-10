import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ItineraryItemEntity } from './itinerary-item.entity';
import { TripEntity } from '../trips/trip.entity';
import { ItineraryController } from './itinerary.controller';
import { ItineraryService } from './itinerary.service';

@Module({
  imports: [TypeOrmModule.forFeature([ItineraryItemEntity, TripEntity])],
  controllers: [ItineraryController],
  providers: [ItineraryService],
  exports: [ItineraryService],
})
export class ItineraryModule {}
