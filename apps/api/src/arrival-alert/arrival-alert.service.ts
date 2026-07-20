import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { addDaysToIsoDate, haversineMeters, toKstIsoDate } from '@tripick/utils';
import { ItineraryItemEntity } from '../itinerary/itinerary-item.entity';
import { TripEntity } from '../trips/trip.entity';
import { InboxService } from '../inbox/inbox.service';
import { TripMembersService } from '../trip-members/trip-members.service';
import { LiveLocationService } from './live-location.service';
import {
  ARRIVAL_DEDUPE_MIN_TTL_SEC,
  ARRIVAL_GRACE_MIN,
  ARRIVAL_LATE_LIMIT_MIN,
  ARRIVAL_RADIUS_M,
  LOCATION_STALE_MS,
} from './arrival-alert.constants';

/** 알림 대상 여행 상태 — draft·cancelled·completed 는 제외. */
const ACTIVE_STATUSES = ['confirmed', 'in_progress'] as const;

/**
 * 미도착 감지 알림 스캐너.
 *
 * 날씨·혼잡 알림과 같은 철학 — 자동 재계획을 걸지 않는다. 각 일정 항목의 시작 시각에서
 * 유예(ARRIVAL_GRACE_MIN)를 지난 뒤에도 사용자의 최신 위치가 그 좌표 반경(ARRIVAL_RADIUS_M)
 * 밖이면 "아직 근처에 안 계세요, 일정을 조정할까요?" arrival_alert 인박스 알림만 보낸다.
 * 실제 변경은 사용자가 알림을 눌러 planner 에서 직접 한다.
 *
 * 판정은 사용자별로 각자의 최신 위치로 하고, 위치가 없거나 오래됐으면(LOCATION_STALE_MS)
 * 판정 불가로 보고 건너뛴다(위치를 모르면서 미도착 처리하지 않는다).
 */
@Injectable()
export class ArrivalAlertService {
  private readonly logger = new Logger(ArrivalAlertService.name);

  constructor(
    @InjectRepository(TripEntity)
    private readonly tripsRepo: Repository<TripEntity>,
    @InjectRepository(ItineraryItemEntity)
    private readonly itemsRepo: Repository<ItineraryItemEntity>,
    private readonly inboxService: InboxService,
    private readonly tripMembersService: TripMembersService,
    private readonly liveLocation: LiveLocationService,
  ) {}

  /**
   * "시작+유예"를 막 지난 일정 항목을 훑어, 근처에 없는 사용자에게 미도착 알림을 보낸다.
   * 한 항목/사용자의 실패가 나머지를 막지 않는다.
   *
   * @returns 발송한 알림 건수
   */
  async scanDueItems(now: Date = new Date()): Promise<number> {
    const items = await this.findDueItems(now);
    if (items.length === 0) return 0;

    // 후보 항목이 걸린 여행 중 알림 대상(active) 만 남긴다.
    const tripIds = [...new Set(items.map((item) => item.tripId))];
    const activeTrips = await this.tripsRepo.find({
      where: { id: In(tripIds), status: In([...ACTIVE_STATUSES]) },
    });
    const tripById = new Map(activeTrips.map((trip) => [trip.id, trip]));
    if (tripById.size === 0) return 0;

    // 같은 (여행, 사용자, 일차)당 1회만 알리므로, 이른 항목부터 판정해 첫 미도착이 그날을 선점하게 한다.
    const dueItems = items
      .filter((item) => tripById.has(item.tripId))
      .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());

    const recipientsByTrip = new Map<string, string[]>();
    let alerted = 0;

    for (const item of dueItems) {
      const trip = tripById.get(item.tripId)!;
      try {
        const recipients = await this.resolveRecipients(item.tripId, recipientsByTrip);
        for (const userId of recipients) {
          if (await this.evaluateAndNotify(trip, item, userId, now)) alerted += 1;
        }
      } catch (err) {
        this.logger.error(`미도착 판정 실패 (trip ${item.tripId}, item ${item.id}):`, err);
      }
    }

    if (alerted > 0) this.logger.log(`미도착 스캔 완료 — 알림 ${alerted}건`);
    return alerted;
  }

  /**
   * 판정 대상 항목: scheduledAt 이 [now-유예-지각상한, now-유예] 구간에 든 것.
   * 즉 "시작+유예"를 막 지났고 지각 상한을 넘지 않은 항목. 좌표가 없으면 판정 불가라 제외한다.
   */
  private async findDueItems(now: Date): Promise<ItineraryItemEntity[]> {
    const upper = new Date(now.getTime() - ARRIVAL_GRACE_MIN * 60_000);
    const lower = new Date(upper.getTime() - ARRIVAL_LATE_LIMIT_MIN * 60_000);
    const items = await this.itemsRepo.find({
      where: { scheduledAt: Between(lower, upper) },
    });
    return items.filter((item) => item.coordinates?.lat != null && item.coordinates?.lng != null);
  }

  /** 여행 수신자(owner + accepted 멤버) 목록을 여행당 1회만 조회해 캐시한다. */
  private async resolveRecipients(
    tripId: string,
    cache: Map<string, string[]>,
  ): Promise<string[]> {
    const cached = cache.get(tripId);
    if (cached) return cached;
    const { userIds } = await this.tripMembersService.getNotificationTargets(tripId);
    cache.set(tripId, userIds);
    return userIds;
  }

  /**
   * 사용자 1명에 대해 미도착이면 알림을 보낸다. 판정·발송했으면 true.
   * - 위치 없음/오래됨 → 판정 불가, skip
   * - 반경 안 → 도착, skip
   * - 반경 밖 → (여행,사용자,일차) 선점 성공 시에만 발송(중복 억제)
   */
  private async evaluateAndNotify(
    trip: TripEntity,
    item: ItineraryItemEntity,
    userId: string,
    now: Date,
  ): Promise<boolean> {
    const loc = await this.liveLocation.getFresh(userId, LOCATION_STALE_MS, now);
    if (!loc) return false;

    const distance = haversineMeters(loc, item.coordinates);
    if (distance <= ARRIVAL_RADIUS_M) return false;

    // 발송 직전에 선점 — 발송 후 기록하면 중간 실패 시 재시도가 중복 발송한다.
    // 억제 기간은 그 항목의 KST 일자 끝까지라, 하루 일정이 길어도 (여행,사용자,일차)당 1회만.
    const ttlSec = this.dedupeTtlSec(item, now);
    if (!(await this.liveLocation.claimAlert(trip.id, userId, item.day, ttlSec))) return false;

    try {
      await this.notify(trip, item, userId);
      return true;
    } catch (err) {
      this.logger.error(`미도착 알림 발송 실패 (trip ${trip.id}, user ${userId}):`, err);
      return false;
    }
  }

  /** 미도착 알림 1건 발송. InboxService.create 가 수신 토글 확인 + FCM 발송까지 담당한다. */
  private async notify(
    trip: TripEntity,
    item: ItineraryItemEntity,
    userId: string,
  ): Promise<void> {
    const label = trip.title || '여행';
    const body =
      `${item.day}일차 '${item.name}' 일정 시작 시간인데 아직 근처에 안 계세요. ` +
      `일정을 조정할까요?`;

    await this.inboxService.create({
      userId,
      category: 'arrival_alert',
      title: `📍 ${label} — ${item.name} 미도착`,
      body,
      payload: {
        tripId: trip.id,
        day: String(item.day),
        itemId: item.id,
        place: item.name,
      },
    });
  }

  /**
   * 중복 억제 키 TTL(초) — 그 항목의 KST 일자가 끝날 때(다음날 00:00 KST)까지 남은 시간.
   * 하루 일정이 6시간을 넘겨도 오후 항목에서 키가 만료돼 재알림되지 않게 한다.
   */
  private dedupeTtlSec(item: ItineraryItemEntity, now: Date): number {
    const nextDayIso = addDaysToIsoDate(toKstIsoDate(item.scheduledAt), 1);
    const endOfDayKst = Date.parse(`${nextDayIso}T00:00:00+09:00`);
    const remainSec = Math.ceil((endOfDayKst - now.getTime()) / 1000);
    return Math.max(remainSec, ARRIVAL_DEDUPE_MIN_TTL_SEC);
  }
}
