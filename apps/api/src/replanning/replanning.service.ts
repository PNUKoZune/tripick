import {
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { haversineMeters } from '@tripick/utils';
import { withTimeout } from '../common/with-timeout';
import {
  REPLAN_QUEUE,
  REPLAN_JOB,
  REPLAN_LOCATION_MAX_DISTANCE_M,
  REPLAN_QUEUE_TIMEOUT_MS,
} from './replanning.constants';
import { LOCATION_STALE_MS } from '../arrival-alert/arrival-alert.constants';
import { LiveLocationService } from '../arrival-alert/live-location.service';
import { ItineraryItemEntity } from '../itinerary/itinerary-item.entity';
import { TripMembersService } from '../trip-members/trip-members.service';
import type { ReplanRequestDto, ReplanJobDto } from '@tripick/types';

@Injectable()
export class ReplanningService {
  private readonly logger = new Logger(ReplanningService.name);

  constructor(
    @InjectQueue(REPLAN_QUEUE) private readonly queue: Queue<ReplanRequestDto>,
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

    // 같은 일차를 다시 짜는 잡이 이미 큐에 있으면 새로 등록하지 않고 그 잡을 돌려준다.
    const inFlight = await this.findInFlight(dto);
    if (inFlight) return inFlight;

    const request = await this.withCurrentLocation(userId, dto);

    // P3-12: 짧은 시간 창(10초) 안의 동시 제출을 BullMQ jobId 로 한 번 더 막는다.
    // 위 진행 중 조회와 실제 add 사이에 다른 요청이 끼어들 수 있어서(조회 시점엔 둘 다 큐가
    // 비어 보인다) 남겨 둔 레이스 가드다. 대상 일차는 키에 넣는다 — 이 창 안에서도
    // "1일차 → 곧바로 2일차" 는 별개 작업이라 합쳐지면 두 번째가 조용히 버려진다.
    const bucket = Math.floor(Date.now() / 10_000);
    const job = await withTimeout(
      this.queue.add(REPLAN_JOB, request, {
        jobId: `${dto.tripId}-${scopeKey(dto.targetDays)}-${bucket}`,
        // 잡 자체는 조회 API 가 없고 결과는 WS·인박스로 간다 — 사후 확인용으로만 잠깐 남긴다.
        // 지정하지 않으면 완료·실패 잡이 Redis 에 무한 적재된다(다른 큐는 모두 지정돼 있다).
        removeOnComplete: { age: 3600, count: 100 },
        removeOnFail: { age: 86400 },
      }),
      REPLAN_QUEUE_TIMEOUT_MS,
      '재계획 잡 등록 응답 없음',
    ).catch((err: unknown) => {
      // Redis 가 죽어 있으면 add 는 던지지도 끝나지도 않는다 — 상한이 없으면 이 HTTP 요청이
      // 영영 매달려 사용자는 스피너만 본다. 잡이 안 걸렸음을 분명히 알린다.
      this.logger.error(
        `재계획 잡 등록 실패 (trip ${dto.tripId}): ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new ServiceUnavailableException(
        '지금은 재계획을 시작할 수 없습니다. 잠시 후 다시 시도해주세요.',
      );
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
   * 같은 여행에서 **대상 일차가 겹치는** 재계획 잡이 이미 큐에 있으면 그 잡을 DTO 로 돌려준다.
   *
   * 예전엔 dedup 이 `${tripId}-${trigger}-${scope}-${10초버킷}` jobId 하나뿐이라 두 갈래로 샜다 —
   * ① 트리거가 키에 있어 배너(`weather`) → FAB(`manual`) 로 연달아 제출하면 같은 일차가 두 번
   * 재생성됐고, ② 재계획 한 건이 LLM 때문에 분 단위인데 창은 10초라 "왜 안 바뀌지" 하고 다시
   * 누른 요청이 그대로 또 돌았다. 둘 다 결과가 두 번 덮어써지고 완료 알림도 두 번 간다.
   *
   * 트리거는 보지 않는다 — 무엇 때문에 눌렀든 같은 일차를 다시 짜는 작업이면 중복이다.
   * 반대로 겹치지 않는 일차(1일차 진행 중 + 2일차 요청)는 별개 작업이라 그대로 등록한다.
   */
  private async findInFlight(dto: ReplanRequestDto): Promise<ReplanJobDto | null> {
    // Redis 무응답이면 조회가 매달린다 — 실패는 "진행 중 없음" 으로 보고 뒤이은 add 에 맡긴다
    // (한 요청에서 두 번 기다리지 않도록). 최악이라도 예전처럼 잡이 하나 더 도는 것뿐이다.
    const jobs = await withTimeout(
      this.queue.getJobs(['active', 'waiting', 'waiting-children', 'delayed']),
      REPLAN_QUEUE_TIMEOUT_MS,
      '진행 중 재계획 잡 조회 응답 없음',
    ).catch((err: unknown) => {
      this.logger.warn(
        `진행 중 재계획 조회 실패 — dedup 없이 등록한다: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    });
    if (!jobs) return null;

    const running = jobs.find(
      (job) => job?.data?.tripId === dto.tripId && overlapsDays(job.data.targetDays, dto.targetDays),
    );
    if (!running) return null;

    // 조회와 여기 사이에 끝났을 수 있다. 끝난 잡을 "진행 중" 이라고 돌려주면 클라이언트는
    // 이미 지나간 WS 결과를 영영 기다린다 — 그 경우엔 정상 등록으로 흘려보낸다.
    const state = await running.getState().catch(() => 'waiting');
    if (state === 'completed' || state === 'failed' || state === 'unknown') return null;

    return {
      jobId: String(running.id),
      tripId: dto.tripId,
      trigger: running.data.trigger,
      status: state === 'active' ? 'processing' : 'pending',
      createdAt: new Date(running.timestamp).toISOString(),
      deduped: true,
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

/** dedup jobId 에 쓰는 범위 키. 빈 배열·생략은 전체 재계획(`all`). */
function scopeKey(targetDays?: number[]): string {
  return targetDays?.length ? [...targetDays].sort((a, b) => a - b).join('.') : 'all';
}

/**
 * 두 재계획 요청이 같은 일차를 건드리는가. 한쪽이라도 전체 재계획(생략·빈 배열)이면 항상 겹친다.
 *
 * 일부만 겹치는 경우([1,2] 진행 중 + [2,3] 요청)도 겹침으로 본다 — 안 겹치는 3일차를 살리려고
 * 새 잡을 등록하면 2일차가 두 번 재생성되고, 나중 잡이 앞 결과를 다시 덮는다. 흔한 경우도 아니라
 * "겹치면 진행 중인 잡으로 합친다" 는 규칙 하나로 두는 쪽이 낫다(사용자는 완료 후 다시 요청).
 */
function overlapsDays(a?: number[], b?: number[]): boolean {
  if (!a?.length || !b?.length) return true;
  return a.some((day) => b.includes(day));
}
