import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Redis } from 'ioredis';
import { In, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { ItineraryItemEntity } from '../itinerary/itinerary-item.entity';
import { TripEntity } from '../trips/trip.entity';
import { InboxService } from '../inbox/inbox.service';
import { TripMembersService } from '../trip-members/trip-members.service';
import {
  ConcentrationSeries,
  TatsCnctrRateService,
} from '../planner/retrieval/tats-cnctr-rate.service';
import { KtoCallBudget, KtoQuotaExceededError } from '../planner/retrieval/tour-api.service';
import { getKstParts } from '@tripick/utils';
import {
  CONCENTRATION_HORIZON_DAYS,
  CROWD_MIN_RATE,
  CROWD_RELATIVE_MULTIPLIER,
  CROWD_SCAN_CALL_BUDGET,
  CROWD_SENSITIVE_TYPES,
  MAX_TRIP_DAYS,
  MIN_DEDUPE_TTL_SEC,
} from './crowd-alert.constants';

/** 혼잡이 예상되는 여행 일자 1건. */
interface CrowdedDay {
  /** 여행 시작일 기준 1-based 일차 */
  day: number;
  /** YYYY-MM-DD */
  iso: string;
  /** 혼잡 예상 관광지 (알림 본문용, 최대 2개까지 노출) */
  places: Array<{ name: string; rate: number }>;
}

/**
 * 관광지 집중률(혼잡도) 트리거 알림 스캐너.
 *
 * 날씨 알림과 동일한 철학 — 자동 재계획을 걸지 않는다. 여행 일정의 관광지가 예정일에
 * 붐빌 것으로 예측되면 "사람이 많이 몰릴 수 있어요, 바꿔볼까요?" 를 묻는 crowd_alert 인박스
 * 알림만 보내고, 실제 변경은 사용자가 여행 화면에서 직접 한다.
 *
 * 집중률은 취향 추천을 흐릴 수 있어 일정 생성/재계획 점수에는 반영하지 않는다 —
 * 오직 이 추천 알림 경로에서만 쓰인다.
 */
@Injectable()
export class CrowdAlertService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CrowdAlertService.name);
  private readonly redis: Redis;

  constructor(
    @InjectRepository(TripEntity)
    private readonly tripsRepo: Repository<TripEntity>,
    @InjectRepository(ItineraryItemEntity)
    private readonly itemsRepo: Repository<ItineraryItemEntity>,
    private readonly tatsCnctrRate: TatsCnctrRateService,
    private readonly inboxService: InboxService,
    private readonly tripMembersService: TripMembersService,
    config: ConfigService,
  ) {
    // Redis 가 죽어도 스캔은 굴러가야 하므로 에러는 삼킨다. 여기 쓰기는 중복 알림 억제
    // 기록이라, 연결 전 유실되면 다음 스캔이 같은 날을 또 알린다(누락보다 중복을 택함).
    this.redis = new Redis({
      host: config.get<string>('REDIS_HOST', 'localhost'),
      port: config.get<number>('REDIS_PORT', 6379),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    this.redis.on('error', () => undefined);
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.redis.connect();
    } catch {
      // 연결 실패 시에도 부팅은 막지 않는다 — 중복 억제만 degrade 된다.
    }
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }

  /**
   * 예측 구간에 걸친 모든 여행을 훑어 혼잡 예상 일자에 알림을 보낸다.
   * 한 여행의 실패(쿼터 초과 포함)가 나머지 스캔을 막지 않는다.
   *
   * @returns 알림을 보낸 (여행, 일자) 건수
   */
  async scanUpcomingTrips(now: Date = new Date()): Promise<number> {
    const trips = await this.findTripsInForecastWindow(now);
    if (trips.length === 0) {
      this.logger.log('예측 구간에 걸친 여행 없음 — 혼잡 스캔 종료');
      return 0;
    }

    this.logger.log(`혼잡 스캔 시작 — 대상 여행 ${trips.length}건`);
    // KTO 일일 한도(적재와 공유)를 스캔이 독점하지 않도록 이번 실행의 호출 예산을 선제 캡한다.
    const budget = new KtoCallBudget(CROWD_SCAN_CALL_BUDGET);
    let alerted = 0;
    for (const trip of trips) {
      if (budget.isExhausted) {
        this.logger.warn('혼잡 스캔 호출 예산 소진 — 남은 여행은 다음 주기에 스캔');
        break;
      }
      try {
        alerted += await this.scanTrip(trip, now, budget);
      } catch (err) {
        if (err instanceof KtoQuotaExceededError) {
          // 일일 호출량 초과면 남은 여행도 마찬가지다 — 스캔을 접고 다음 주기에 재시도한다.
          this.logger.warn('KTO 호출량 초과 — 혼잡 스캔 중단');
          break;
        }
        this.logger.error(`여행 ${trip.id} 혼잡 스캔 실패:`, err);
      }
    }
    this.logger.log(`혼잡 스캔 완료 — 알림 ${alerted}건 발송`);
    return alerted;
  }

  /**
   * 진행 예정·진행 중인 여행 중 예측 구간(오늘 ~ +N일)과 겹치는 것만 고른다.
   * draft·cancelled·completed 는 알릴 대상이 아니다.
   */
  private async findTripsInForecastWindow(now: Date): Promise<TripEntity[]> {
    const today = this.kstToday(now);
    const horizon = this.addDaysIso(today, CONCENTRATION_HORIZON_DAYS);

    return this.tripsRepo.find({
      where: {
        status: In(['confirmed', 'in_progress']),
        startDate: LessThanOrEqual(horizon),
        endDate: MoreThanOrEqual(today),
      },
    });
  }

  /** 여행 1건 스캔 → 혼잡 예상 일자마다 알림 발송. 발송 건수 반환. */
  private async scanTrip(trip: TripEntity, now: Date, budget: KtoCallBudget): Promise<number> {
    const items = await this.itemsRepo.find({ where: { tripId: trip.id } });

    // 미래 후보일(오늘 이후 + 관광지 일정이 있는 날)만 추린다. 과거일 관광지까지 조회하면
    // 알릴 수도 없는 날에 KTO 호출을 낭비하므로 series 조회 전에 먼저 좁힌다.
    const todayIso = this.kstToday(now);
    const candidates = this.tripDays(trip)
      .filter(({ iso }) => iso >= todayIso)
      .map(({ day, iso }) => ({
        day,
        iso,
        items: items.filter(
          (item) => item.day === day && CROWD_SENSITIVE_TYPES.includes(item.type),
        ),
      }))
      .filter(({ items: dayItems }) => dayItems.length > 0);
    if (candidates.length === 0) return 0;

    // 후보일에 실제 등장하는 관광지만 1회씩 조회해 캐시한다(같은 장소가 여러 날 나올 수 있음).
    // null = 지역코드 해석 실패·데이터 없음·예산 소진 → 이후 그 장소는 건너뛴다.
    const needed = new Map<string, ItineraryItemEntity>();
    for (const candidate of candidates) {
      for (const item of candidate.items) {
        if (!needed.has(item.name)) needed.set(item.name, item);
      }
    }
    const seriesByPlace = new Map<string, ConcentrationSeries | null>();
    for (const [name, item] of needed) {
      seriesByPlace.set(name, await this.loadSeries(item, budget));
    }

    let recipients: string[] | null = null;
    let alerted = 0;

    for (const candidate of candidates) {
      const crowded = this.evaluateDay(candidate, seriesByPlace);
      if (!crowded) continue;

      recipients ??= (await this.tripMembersService.getNotificationTargets(trip.id)).userIds;
      if (recipients.length === 0) break;

      // 발송 전에 중복 억제 키를 선점한다 — 발송 후 기록하면 중간 실패 시 재시도가 중복 발송한다.
      if (!(await this.claimAlert(trip.id, crowded.iso, now))) continue;

      try {
        await this.notify(trip, crowded, recipients);
        alerted += 1;
      } catch (err) {
        this.logger.error(`혼잡 알림 발송 실패 (trip ${trip.id}, ${crowded.iso}):`, err);
      }
    }
    return alerted;
  }

  /** 일정 항목의 주소·이름으로 그 관광지의 집중률 시계열을 조회한다. 예산 소진 시 null. */
  private async loadSeries(
    item: ItineraryItemEntity,
    budget: KtoCallBudget,
  ): Promise<ConcentrationSeries | null> {
    const region = await this.tatsCnctrRate.resolveRegionCode(item.address);
    if (!region) return null;
    // 집중률 조회는 관광지당 1콜 — 예산에서 먼저 차감하고, 소진이면 더 조회하지 않는다.
    if (!budget.consume()) return null;
    return this.tatsCnctrRate.fetchConcentration(region.areaCd, region.signguCd, item.name);
  }

  /**
   * 해당 일자가 "붐빌 것 같은" 날인지 판정한다. 그 날 예정된 관광지 중 예측 집중률이
   * (평균×배수) 이상이고 절대 하한을 넘는 곳을 모은다. 하나도 없으면 null.
   */
  private evaluateDay(
    candidate: { day: number; iso: string; items: ItineraryItemEntity[] },
    seriesByPlace: Map<string, ConcentrationSeries | null>,
  ): CrowdedDay | null {
    const ymd = candidate.iso.replace(/-/g, '');
    const places: Array<{ name: string; rate: number }> = [];

    for (const item of candidate.items) {
      const series = seriesByPlace.get(item.name);
      if (!series) continue;
      const rate = series.ratesByYmd.get(ymd);
      if (rate === undefined) continue;
      if (rate >= series.mean * CROWD_RELATIVE_MULTIPLIER && rate >= CROWD_MIN_RATE) {
        places.push({ name: item.name, rate });
      }
    }

    if (places.length === 0) return null;
    // 붐빔 정도가 큰 순으로 노출한다.
    places.sort((a, b) => b.rate - a.rate);
    return { day: candidate.day, iso: candidate.iso, places };
  }

  /**
   * 여행 수신자(owner + accepted 멤버) 전원에게 "바꿔볼까요?" 알림을 보낸다.
   * InboxService.create 가 수신 토글 확인 + FCM 발송까지 담당한다.
   */
  private async notify(trip: TripEntity, crowded: CrowdedDay, userIds: string[]): Promise<void> {
    const label = trip.title || '여행';
    const shown = crowded.places.slice(0, 2);
    const names = shown.map((p) => p.name).join(', ');
    const topRate = Math.round(crowded.places[0]!.rate);
    const body =
      `${crowded.day}일차(${crowded.iso})에 ${names}에 사람이 많이 몰릴 수 있어요` +
      `(예상 집중률 ${topRate}%). 일정을 바꿔볼까요?`;

    await Promise.all(
      userIds.map((userId) =>
        this.inboxService.create({
          userId,
          category: 'crowd_alert',
          title: `👥 ${label} ${crowded.day}일차 혼잡 예상`,
          body,
          payload: {
            tripId: trip.id,
            day: String(crowded.day),
            date: crowded.iso,
            places: shown.map((p) => p.name).join('|'),
          },
        }),
      ),
    );
  }

  /**
   * 같은 (여행, 일자) 발송 권한을 SET NX 로 원자적으로 선점한다. TTL 이 대상 날짜 끝까지라
   * 알림은 (여행, 일자)당 1회만 나간다. Redis 장애 시 true — 중복될 순 있어도 누락되지 않게.
   */
  private async claimAlert(tripId: string, iso: string, now: Date): Promise<boolean> {
    try {
      const res = await this.redis.set(
        this.dedupeKey(tripId, iso),
        '1',
        'EX',
        this.dedupeTtlSec(iso, now),
        'NX',
      );
      return res === 'OK';
    } catch {
      return true;
    }
  }

  /** 대상 날짜(iso)가 KST 로 끝날 때까지 남은 초. */
  private dedupeTtlSec(iso: string, now: Date): number {
    const endOfDayKst = Date.parse(`${this.addDaysIso(iso, 1)}T00:00:00+09:00`);
    const remainSec = Math.ceil((endOfDayKst - now.getTime()) / 1000);
    return Math.max(remainSec, MIN_DEDUPE_TTL_SEC);
  }

  private dedupeKey(tripId: string, iso: string): string {
    return `crowd:alert:sent:${tripId}:${iso}`;
  }

  /**
   * 여행 기간의 (일차, iso) 목록. startDate~endDate 양끝 포함.
   * MAX_TRIP_DAYS 는 endDate 가 깨진 데이터일 때 무한 루프를 막는 안전장치.
   */
  private tripDays(trip: TripEntity): Array<{ day: number; iso: string }> {
    const days: Array<{ day: number; iso: string }> = [];
    let iso = trip.startDate;
    for (let day = 1; iso <= trip.endDate && day <= MAX_TRIP_DAYS; day += 1) {
      days.push({ day, iso });
      iso = this.addDaysIso(iso, 1);
    }
    return days;
  }

  /** 오늘(KST) 을 YYYY-MM-DD 로. 서버 TZ 가 UTC 여도 KST 기준으로 뽑아 baseYmd 와 맞춘다. */
  private kstToday(now: Date): string {
    const { year, month, day } = getKstParts(now);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  /** YYYY-MM-DD 에 일수를 더한다. UTC 기준 산술이라 서버 TZ·서머타임에 영향받지 않는다. */
  private addDaysIso(iso: string, days: number): string {
    const [y = 0, m = 1, d = 1] = iso.split('-').map(Number);
    const utc = new Date(Date.UTC(y, m - 1, d));
    utc.setUTCDate(utc.getUTCDate() + days);
    return utc.toISOString().slice(0, 10);
  }
}
