import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Redis } from 'ioredis';
import { In, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { ItineraryItemEntity } from '../itinerary/itinerary-item.entity';
import { TripEntity } from '../trips/trip.entity';
import { InboxService } from '../inbox/inbox.service';
import { TripMembersService } from '../trip-members/trip-members.service';
import { WeatherHelper } from '../planner/helpers/weather.helper';
import {
  ALERT_DEDUPE_TTL_SEC,
  FORECAST_HORIZON_DAYS,
  MIN_RAINY_SLOTS,
  RAIN_PROBABILITY_THRESHOLD,
  WEATHER_SENSITIVE_TYPES,
} from './weather-alert.constants';
import type { ParsedForecast } from '@tripick/utils';

/** 비 예보가 걸린 여행 일자 1건. */
interface RainyDay {
  /** 여행 시작일 기준 1-based 일차 */
  day: number;
  /** YYYY-MM-DD */
  iso: string;
  /** 해당 일자의 최대 강수확률(%) */
  maxProbability: number;
  /** 비에 노출되는 관광지 일정 이름 (알림 본문용, 최대 2개) */
  exposedPlaces: string[];
}

/**
 * 날씨 트리거 알림 스캐너.
 *
 * 자동 재계획을 걸지 않는다 — 비 예보를 감지하면 사용자에게 "변경할까요?" 를 묻는
 * weather_alert 인박스 알림만 보내고, 실제 변경은 사용자가 여행 화면에서 직접 한다.
 * (인박스의 weather_alert 는 open-trip 액션으로 /planner 로 이동한다.)
 */
@Injectable()
export class WeatherAlertService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WeatherAlertService.name);
  private readonly redis: Redis;

  constructor(
    @InjectRepository(TripEntity)
    private readonly tripsRepo: Repository<TripEntity>,
    @InjectRepository(ItineraryItemEntity)
    private readonly itemsRepo: Repository<ItineraryItemEntity>,
    private readonly weatherHelper: WeatherHelper,
    private readonly inboxService: InboxService,
    private readonly tripMembersService: TripMembersService,
    config: ConfigService,
  ) {
    // Redis 가 죽어도 스캔 자체는 굴러가야 하므로 에러는 삼킨다.
    // 다만 WeatherHelper 와 달리 offline queue 는 켠 채로 둔다 — 여기 쓰기는 캐시가 아니라
    // 중복 알림 억제 기록이라, 연결 전에 유실되면 다음 스캔이 같은 날을 또 알린다.
    this.redis = new Redis({
      host: config.get<string>('REDIS_HOST', 'localhost'),
      port: config.get<number>('REDIS_PORT', 6379),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    this.redis.on('error', () => undefined);
  }

  /** 첫 스캔의 중복 억제 기록이 유실되지 않도록 연결을 미리 맺어둔다. */
  async onModuleInit(): Promise<void> {
    try {
      await this.redis.connect();
    } catch {
      // 연결 실패 시에도 부팅은 막지 않는다 — 중복 억제만 degrade 된다.
    }
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }

  /**
   * 예보 구간에 걸친 모든 여행을 훑어 비 예보가 있는 일자에 알림을 보낸다.
   * 한 여행의 실패가 나머지 스캔을 막지 않는다.
   *
   * @returns 알림을 보낸 (여행, 일자) 건수
   */
  async scanUpcomingTrips(now: Date = new Date()): Promise<number> {
    const trips = await this.findTripsInForecastWindow(now);
    if (trips.length === 0) {
      this.logger.log('예보 구간에 걸친 여행 없음 — 스캔 종료');
      return 0;
    }

    this.logger.log(`날씨 스캔 시작 — 대상 여행 ${trips.length}건`);
    let alerted = 0;
    for (const trip of trips) {
      try {
        alerted += await this.scanTrip(trip, now);
      } catch (err) {
        this.logger.error(`여행 ${trip.id} 날씨 스캔 실패:`, err);
      }
    }
    this.logger.log(`날씨 스캔 완료 — 알림 ${alerted}건 발송`);
    return alerted;
  }

  /**
   * 진행 예정·진행 중인 여행 중 예보 구간(오늘 ~ +10일)과 겹치는 것만 고른다.
   * draft·cancelled·completed 는 알릴 대상이 아니다.
   */
  private async findTripsInForecastWindow(now: Date): Promise<TripEntity[]> {
    const today = this.toIsoDate(now);
    const horizon = this.toIsoDate(this.addDays(now, FORECAST_HORIZON_DAYS));

    return this.tripsRepo.find({
      where: {
        status: In(['confirmed', 'in_progress']),
        // 여행 구간 [startDate, endDate] 과 예보 구간 [today, horizon] 이 겹치는 조건
        startDate: LessThanOrEqual(horizon),
        endDate: MoreThanOrEqual(today),
      },
    });
  }

  /** 여행 1건 스캔 → 비 예보 일자마다 알림 발송. 발송 건수 반환. */
  private async scanTrip(trip: TripEntity, now: Date): Promise<number> {
    const items = await this.itemsRepo.find({ where: { tripId: trip.id } });
    if (items.length === 0) {
      return 0;
    }

    const center = this.averageCenter(items);
    const forecasts = await this.weatherHelper.getExtendedForecast(center.lat, center.lng);
    if (forecasts.size === 0) {
      return 0;
    }

    const rainyDays = this.findRainyDays(trip, items, forecasts, now);
    let alerted = 0;
    for (const rainy of rainyDays) {
      if (await this.alreadyAlerted(trip.id, rainy.iso)) continue;
      await this.notify(trip, rainy);
      await this.markAlerted(trip.id, rainy.iso);
      alerted += 1;
    }
    return alerted;
  }

  /**
   * 여행 일자 중 "비 올 것 같은" 날을 고른다. 조건 3개를 모두 만족해야 한다.
   * 1) 오늘 이후(지난 날짜는 알릴 의미 없음)이고 예보가 존재하는 날
   * 2) 강수 슬롯이 MIN_RAINY_SLOTS 이상 — 새벽 한 슬롯만 걸린 날은 제외
   * 3) 그 날 야외(attraction) 일정이 하나라도 있는 날
   */
  private findRainyDays(
    trip: TripEntity,
    items: ItineraryItemEntity[],
    forecasts: Map<string, ParsedForecast>,
    now: Date,
  ): RainyDay[] {
    const slots = [...forecasts.values()];
    const todayIso = this.toIsoDate(now);
    const rainyDays: RainyDay[] = [];

    for (const { day, iso } of this.tripDays(trip)) {
      if (iso < todayIso) continue;

      const daySlots = slots.filter((s) => s.date === iso.replace(/-/g, ''));
      const rainySlots = daySlots.filter((s) => this.isRainy(s));
      if (rainySlots.length < MIN_RAINY_SLOTS) continue;

      const exposed = items.filter(
        (item) => item.day === day && WEATHER_SENSITIVE_TYPES.includes(item.type),
      );
      if (exposed.length === 0) continue;

      rainyDays.push({
        day,
        iso,
        maxProbability: Math.max(
          ...rainySlots.map((s) => s.precipitationProbability ?? RAIN_PROBABILITY_THRESHOLD),
        ),
        exposedPlaces: exposed.slice(0, 2).map((item) => item.name),
      });
    }

    return rainyDays;
  }

  /** 강수형태(PTY)가 잡혔거나 강수확률이 임계값 이상이면 강수 슬롯으로 본다. */
  private isRainy(slot: ParsedForecast): boolean {
    if (slot.precipitationType !== undefined && slot.precipitationType > 0) return true;
    return (slot.precipitationProbability ?? 0) >= RAIN_PROBABILITY_THRESHOLD;
  }

  /** 여행 기간의 (일차, iso) 목록. startDate~endDate 양끝 포함. */
  private tripDays(trip: TripEntity): Array<{ day: number; iso: string }> {
    const start = new Date(`${trip.startDate}T00:00:00`);
    const end = new Date(`${trip.endDate}T00:00:00`);
    const days: Array<{ day: number; iso: string }> = [];

    for (let cursor = start, day = 1; cursor <= end; cursor = this.addDays(cursor, 1), day += 1) {
      days.push({ day, iso: this.toIsoDate(cursor) });
    }
    return days;
  }

  /** 일정 좌표 평균 — 예보 조회용 대표 좌표(main-planner 의 mapCenter 와 같은 방식). */
  private averageCenter(items: ItineraryItemEntity[]): { lat: number; lng: number } {
    const total = items.reduce(
      (sum, item) => ({
        lat: sum.lat + item.coordinates.lat,
        lng: sum.lng + item.coordinates.lng,
      }),
      { lat: 0, lng: 0 },
    );
    return { lat: total.lat / items.length, lng: total.lng / items.length };
  }

  /**
   * 여행 수신자(owner + accepted 멤버) 전원에게 "변경할까요?" 알림을 보낸다.
   * InboxService.create 가 수신 토글 확인 + FCM 발송까지 담당한다.
   */
  private async notify(trip: TripEntity, rainy: RainyDay): Promise<void> {
    const { userIds } = await this.tripMembersService.getNotificationTargets(trip.id);
    if (userIds.length === 0) return;

    const label = trip.title || '여행';
    const places = rainy.exposedPlaces.join(', ');
    const body =
      `${rainy.day}일차(${rainy.iso})에 비 예보가 있어요(강수확률 ${rainy.maxProbability}%). ` +
      `${places} 일정이 영향을 받을 수 있어요. 일정을 바꿔볼까요?`;

    await Promise.all(
      userIds.map((userId) =>
        this.inboxService.create({
          userId,
          category: 'weather_alert',
          title: `☔ ${label} ${rainy.day}일차 비 예보`,
          body,
          payload: {
            tripId: trip.id,
            day: String(rainy.day),
            date: rainy.iso,
            probability: String(rainy.maxProbability),
          },
        }),
      ),
    );
  }

  /**
   * 같은 (여행, 일자) 에 이미 알렸는지 확인한다.
   * Redis 장애 시 false 를 반환 — 알림이 중복될 수는 있어도 누락되지는 않게 한다.
   */
  private async alreadyAlerted(tripId: string, iso: string): Promise<boolean> {
    try {
      return (await this.redis.exists(this.dedupeKey(tripId, iso))) === 1;
    } catch {
      return false;
    }
  }

  private async markAlerted(tripId: string, iso: string): Promise<void> {
    try {
      await this.redis.set(this.dedupeKey(tripId, iso), '1', 'EX', ALERT_DEDUPE_TTL_SEC);
    } catch {
      // 중복 억제 실패는 알림 발송 자체를 되돌리지 않는다.
    }
  }

  private dedupeKey(tripId: string, iso: string): string {
    return `weather:alert:sent:${tripId}:${iso}`;
  }

  private toIsoDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private addDays(date: Date, days: number): Date {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }
}
