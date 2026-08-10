import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReplanningController } from './replanning.controller';
import { ReplanningService } from './replanning.service';
import { REPLAN_QUEUE } from './replanning.constants';
import { LiveLocationModule } from '../arrival-alert/live-location.module';
import { ItineraryItemEntity } from '../itinerary/itinerary-item.entity';
import { TripMembersModule } from '../trip-members/trip-members.module';

@Module({
  // LiveLocationModule: 미도착 판정에 쓰는 최신 위치 캐시를 이탈 재계획 위치 주입에 재사용한다
  // (ArrivalAlertModule 통째로 가져오면 Inbox·TripMembers 순환에 걸려 부팅이 깨진다).
  // 일정 항목은 그 위치가 여행지 안인지 보는 거리 판정에만 읽는다.
  imports: [
    BullModule.registerQueue({ name: REPLAN_QUEUE }),
    TypeOrmModule.forFeature([ItineraryItemEntity]),
    TripMembersModule,
    LiveLocationModule,
  ],
  controllers: [ReplanningController],
  providers: [ReplanningService],
  exports: [ReplanningService],
})
export class ReplanningModule {}
