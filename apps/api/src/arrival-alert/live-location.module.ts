import { Module } from '@nestjs/common';
import { LiveLocationController } from './live-location.controller';
import { LiveLocationService } from './live-location.service';

/**
 * 실시간 위치 캐시(보고 엔드포인트 + Redis 캐시)만 담은 모듈.
 *
 * ArrivalAlertModule 안에 두면 위치를 쓰려는 다른 도메인(이탈 재계획)이 알림 스캐너·인박스까지
 * 통째로 import 해야 하고, 그 경유가 TripMembers↔Inbox 순환을 건드려 부팅이 깨진다.
 * 이 모듈은 ConfigService 외에 도메인 의존이 없어 어디서 import 해도 그래프가 안전하다.
 */
@Module({
  controllers: [LiveLocationController],
  providers: [LiveLocationService],
  exports: [LiveLocationService],
})
export class LiveLocationModule {}
