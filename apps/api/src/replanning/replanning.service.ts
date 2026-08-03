import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { haversineMeters } from '@tripick/utils';
import { REPLAN_QUEUE, REPLAN_JOB, REPLAN_LOCATION_MAX_DISTANCE_M } from './replanning.constants';
import { LOCATION_STALE_MS } from '../arrival-alert/arrival-alert.constants';
import { LiveLocationService } from '../arrival-alert/live-location.service';
import { ItineraryItemEntity } from '../itinerary/itinerary-item.entity';
import { TripMembersService } from '../trip-members/trip-members.service';
import type { ReplanRequestDto, ReplanJobDto } from '@tripick/types';

@Injectable()
export class ReplanningService {
  private readonly logger = new Logger(ReplanningService.name);

  constructor(
    @InjectQueue(REPLAN_QUEUE) private readonly queue: Queue,
    @InjectRepository(ItineraryItemEntity)
    private readonly itemsRepo: Repository<ItineraryItemEntity>,
    private readonly tripMembersService: TripMembersService,
    private readonly liveLocation: LiveLocationService,
  ) {}

  async enqueue(userId: string, dto: ReplanRequestDto): Promise<ReplanJobDto> {
    // owner 뿐 아니라 accepted 멤버도 이탈 신고·수동 요청으로 재계획을 트리거할 수 있다.
    const canAccess = await this.tripMembersService.canAccessTrip(dto.tripId, userId);
    if (!canAccess) {
      throw new ForbiddenException();
    }

    const request = await this.withCurrentLocation(userId, dto);

    // P3-12: 같은 여행·트리거·대상 일차의 재계획을 짧은 시간 창(10초) 안에서 dedup.
    // BullMQ 는 동일 jobId 를 무시하므로 연속 클릭/중복 제출이 하나의 잡으로 합쳐진다.
    // 대상 일차를 키에 넣지 않으면 "1일차 → 곧바로 2일차" 재계획이 하나로 합쳐져 버려진다.
    const bucket = Math.floor(Date.now() / 10_000);
    const scope = dto.targetDays?.length ? [...dto.targetDays].sort((a, b) => a - b).join('.') : 'all';
    const job = await this.queue.add(REPLAN_JOB, request, {
      jobId: `${dto.tripId}-${dto.trigger}-${scope}-${bucket}`,
    });
    return {
      jobId: String(job.id),
      tripId: dto.tripId,
      trigger: dto.trigger,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * 미도착(deviation) 재계획에 요청자의 최신 위치를 실어 준다.
   *
   * 배너 문구는 "지금 위치에 맞춰" 인데 웹은 좌표를 보내지 않아, CRAG 거리 점수가 중립값으로
   * 떨어지고 카카오 키워드 검색도 반경 앵커 없이 목적지 전역을 훑고 있었다. 위치는 이미
   * 미도착 판정용으로 서버(Redis)에 있으므로 **클라이언트를 거치지 않고 여기서 채운다** —
   * RN 앱에선 네이티브가 위치를 보고해 웹뷰 JS 에 좌표가 없고, 웹도 권한을 다시 물을 필요가 없다.
   * 잡 데이터에 박아 두므로 워커가 늦게 돌아도 "요청한 순간의 위치" 가 유지된다.
   *
   * 위치 주인은 이 요청을 보낸 사용자다 — 비-owner 제안이 승인된 경로(ScheduleChangeService)만
   * owner 위치를 쓰는데, 함께 다니는 일행이고 아래 거리 가드가 있어 그대로 둔다.
   *
   * 세 조건을 모두 만족할 때만 채운다:
   * - 클라이언트가 좌표를 직접 보내지 않았다 (보냈으면 그 값이 정본)
   * - trigger 가 deviation 이다 (manual·weather·crowd 는 여행 전에도 눌리므로 앵커가 해가 된다)
   * - 위치가 신선하고(LOCATION_STALE_MS) 대상 일차 장소에서 REPLAN_LOCATION_MAX_DISTANCE_M 안이다
   */
  private async withCurrentLocation(userId: string, dto: ReplanRequestDto): Promise<ReplanRequestDto> {
    if (dto.currentLocation || dto.trigger !== 'deviation') return dto;

    const loc = await this.liveLocation.getFresh(userId, LOCATION_STALE_MS);
    if (!loc) return dto;

    // 대상 일차 장소에서 얼마나 떨어져 있는지. 좌표를 가진 항목이 없으면 판정 불가 →
    // 앵커를 걸지 않는다(위치가 여행지 안인지 확인할 방법이 없다).
    const distance = await this.distanceToPlan(dto, loc);
    if (distance === null) return dto;
    if (distance > REPLAN_LOCATION_MAX_DISTANCE_M) {
      // 여행지 밖에서 누른 이탈 재계획. 반경 앵커를 걸면 후보 풀이 사용자 주변(집 등)으로
      // 끌려가므로 위치 없이 보낸다 — 지역 전역 검색이 오답보다 낫다.
      this.logger.warn(
        `이탈 재계획 위치 앵커 스킵 — 대상 일차 장소에서 ${Math.round(distance / 1000)}km (trip ${dto.tripId})`,
      );
      return dto;
    }

    return { ...dto, currentLocation: { lat: loc.lat, lng: loc.lng } };
  }

  /**
   * 재계획 대상 일차 장소들 중 가장 가까운 곳까지의 거리(m). 좌표를 가진 항목이 없으면 null.
   * 대상 일차를 안 지정했으면(전체 재계획) 여행 전체 항목을 본다.
   */
  private async distanceToPlan(
    dto: ReplanRequestDto,
    loc: { lat: number; lng: number },
  ): Promise<number | null> {
    const items = await this.itemsRepo.find({ where: { tripId: dto.tripId } });
    const targetDays = dto.targetDays?.length ? new Set(dto.targetDays) : null;
    const distances = items
      .filter((item) => !targetDays || targetDays.has(item.day))
      .filter((item) => item.coordinates?.lat != null && item.coordinates?.lng != null)
      .map((item) => haversineMeters(loc, item.coordinates));
    return distances.length > 0 ? Math.min(...distances) : null;
  }
}
