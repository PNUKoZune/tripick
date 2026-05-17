import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PreferencesModule } from '../preferences/preferences.module';
import { TripEntity } from '../trips/trip.entity';
import { TripMemberEntity } from './trip-member.entity';
import { TripMembersController } from './trip-members.controller';
import { TripMembersService } from './trip-members.service';

@Module({
  imports: [TypeOrmModule.forFeature([TripMemberEntity, TripEntity]), PreferencesModule],
  controllers: [TripMembersController],
  providers: [TripMembersService],
  exports: [TripMembersService],
})
export class TripMembersModule {}
