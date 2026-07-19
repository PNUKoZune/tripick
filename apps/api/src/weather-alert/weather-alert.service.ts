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
import { getKstParts, latLngToGrid } from '@tripick/utils';
import {
  FORECAST_HORIZON_DAYS,
  MAX_TRIP_DAYS,
  MIN_DEDUPE_TTL_SEC,
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
    const today = this.kstToday(now);
    const horizon = this.addDaysIso(today, FORECAST_HORIZON_DAYS);

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

    const todayIso = this.kstToday(now);
    // 지난 날짜와 일정이 없는 날은 볼 필요가 없다.
    const candidates = this.tripDays(trip)
      .filter(({ iso }) => iso >= todayIso)
      .map(({ day, iso }) => ({ day, iso, items: items.filter((item) => item.day === day) }))
      .filter(({ items: dayItems }) => dayItems.length > 0);

    // 같은 격자에 떨어지는 날끼리는 예보를 1회만 조회한다.
    const forecastByGrid = new Map<string, Map<string, ParsedForecast>>();
    // 수신자는 여행 단위로 같으므로 비 오는 날을 처음 만났을 때 1회만 조회한다
    // (비 예보가 없는 여행은 아예 조회하지 않는다).
    let recipients: string[] | null = null;
    let alerted = 0;

    for (const candidate of candidates) {
      const center = this.averageCenter(candidate.items);
      const { nx, ny } = latLngToGrid({ lat: center.lat, lng: center.lng });
      const gridKey = `${nx}:${ny}`;

      let forecasts = forecastByGrid.get(gridKey);
      if (!forecasts) {
        forecasts = await this.weatherHelper.getExtendedForecast(center.lat, center.lng);
        forecastByGrid.set(gridKey, forecasts);
      }

      const rainy = this.evaluateDay(candidate, forecasts);
      if (!rainy) continue;

      recipients ??= (await this.tripMembersService.getNotificationTargets(trip.id)).userIds;
      // 받을 사람이 없으면 남은 일자도 마찬가지다 — 키를 선점하지 않고 이 여행을 끝낸다.
      if (recipients.length === 0) break;

      // 발송 전에 중복 억제 키를 선점한다 — 발송 후에 기록하면 중간 실패 시
      // BullMQ 재시도가 같은 알림을 다시 보낸다.
      if (!(await this.claimAlert(trip.id, rainy.iso, now))) continue;

      try {
        await this.notify(trip, rainy, recipients);
        alerted += 1;
      } catch (err) {
        // 선점한 키는 일부러 되돌리지 않는다 — 일부 멤버가 이미 받았을 수 있어
        // 재발송(중복)보다 미발송을 택한다.
        this.logger.error(`날씨 알림 발송 실패 (trip ${trip.id}, ${rainy.iso}):`, err);
      }
    }
    return alerted;
  }

  /**
   * 해당 일자가 "비 올 것 같은" 날인지 판정한다. 조건 2개를 모두 만족해야 한다.
   * 1) 강수 슬롯이 MIN_RAINY_SLOTS 이상 — 새벽 한 슬롯만 걸린 날은 제외
   * 2) 야외(attraction) 일정이 하나라도 있는 날
   */
  private evaluateDay(
    candidate: { day: number; iso: string; items: ItineraryItemEntity[] },
    forecasts: Map<string, ParsedForecast>,
  ): RainyDay | null {
    const kmaDate = candidate.iso.replace(/-/g, '');
    const rainySlots = [...forecasts.values()].filter(
      (slot) => slot.date === kmaDate && this.isRainy(slot),
    );
    if (rainySlots.length < MIN_RAINY_SLOTS) return null;

    const exposed = candidate.items.filter((item) => WEATHER_SENSITIVE_TYPES.includes(item.type));
    if (exposed.length === 0) return null;

    return {
      day: candidate.day,
      iso: candidate.iso,
      maxProbability: Math.max(
        ...rainySlots.map((s) => s.precipitationProbability ?? RAIN_PROBABILITY_THRESHOLD),
      ),
      exposedPlaces: exposed.slice(0, 2).map((item) => item.name),
    };
  }

  /** 강수형태(PTY)가 잡혔거나 강수확률이 임계값 이상이면 강수 슬롯으로 본다. */
  private isRainy(slot: ParsedForecast): boolean {
    if (slot.precipitationType !== undefined && slot.precipitationType > 0) return true;
    return (slot.precipitationProbability ?? 0) >= RAIN_PROBABILITY_THRESHOLD;
  }

  /**
   * 여행 기간의 (일차, iso) 목록. startDate~endDate 양끝 포함.
   * 날짜 문자열 산술만 쓰므로 Date 파싱 TZ 에 좌우되지 않는다.
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
   *
   * 수신자는 호출부가 여행당 1회 조회해 넘긴다 — 일자마다 다시 조회할 이유가 없다.
   */
  private async notify(trip: TripEntity, rainy: RainyDay, userIds: string[]): Promise<void> {
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
   * 같은 (여행, 일자) 발송 권한을 선점한다. SET NX 라 확인·기록이 한 번에 원자적으로 끝나,
   * 발송 도중 죽어도 재시도가 중복 발송하지 않는다.
   *
   * TTL 이 대상 날짜 끝까지라 알림은 (여행, 일자)당 1회만 나간다 — 사용자가 일정을
   * 바꾸든 그대로 두든 같은 날짜로 다시 알리지 않는다.
   *
   * Redis 장애 시 true — 알림이 중복될 수는 있어도 누락되지는 않게 한다.
   * @returns 이번 스캔이 발송해도 되면 true, 이미 누가 선점했으면 false
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

  /**
   * 대상 날짜(iso)가 KST 로 끝날 때까지 남은 초.
   * 오프셋을 명시해 파싱하므로 서버 TZ 와 무관하게 KST 자정을 기준으로 계산한다.
   */
  private dedupeTtlSec(iso: string, now: Date): number {
    const endOfDayKst = Date.parse(`${this.addDaysIso(iso, 1)}T00:00:00+09:00`);
    const remainSec = Math.ceil((endOfDayKst - now.getTime()) / 1000);
    return Math.max(remainSec, MIN_DEDUPE_TTL_SEC);
  }

  private dedupeKey(tripId: string, iso: string): string {
    return `weather:alert:sent:${tripId}:${iso}`;
  }

  /**
   * 오늘(KST) 을 YYYY-MM-DD 로 반환한다.
   * 서버 로컬 TZ 를 쓰면 UTC 컨테이너에서 하루가 밀려 기상청 fcstDate(KST) 와 어긋나므로
   * 반드시 KST 기준으로 뽑는다.
   */
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
