import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Redis } from 'ioredis';
import { Repository } from 'typeorm';
import {
  addDaysToIsoDate,
  countTripDays,
  getKstParts,
  toKstIsoDate,
} from '@tripick/utils';
import type {
  DemoConsoleStatusDto,
  DemoItemSummaryDto,
  DemoScenario,
  DemoScenarioRequestDto,
  DemoScenarioResultDto,
  DemoTripOptionDto,
  DemoTripSummaryDto,
} from '@tripick/types';
import { redisConnection } from '../common/redis.config';
import { ItineraryItemEntity } from '../itinerary/itinerary-item.entity';
import { TripEntity } from '../trips/trip.entity';
import { TripMemberEntity } from '../trip-members/trip-member.entity';
import { UserEntity } from '../users/user.entity';
import { ArrivalAlertService } from '../arrival-alert/arrival-alert.service';
import { LiveLocationService } from '../arrival-alert/live-location.service';
import {
  ARRIVAL_GRACE_MIN,
  ARRIVAL_LATE_LIMIT_MIN,
  ARRIVAL_RADIUS_M,
  LOCATION_STALE_MS,
  LOCATION_TTL_SEC,
  arrivalDedupeKey,
  liveLocationKey,
} from '../arrival-alert/arrival-alert.constants';
import { WeatherAlertService } from '../weather-alert/weather-alert.service';
import {
  FORECAST_HORIZON_DAYS,
  WEATHER_SENSITIVE_TYPES,
  weatherDedupeKey,
} from '../weather-alert/weather-alert.constants';
import { CrowdAlertService } from '../crowd-alert/crowd-alert.service';
import {
  CONCENTRATION_HORIZON_DAYS,
  CROWD_SENSITIVE_TYPES,
  crowdDedupeKey,
} from '../crowd-alert/crowd-alert.constants';
import { DemoConcentrationSource, DemoForecastSource } from './demo-alert-sources';
import {
  DEFAULT_DEVIATION_KM,
  DEMO_CROWD_ALERT,
  DEMO_TRIP_TITLE,
  DEMO_WEATHER_ALERT,
  DUE_WINDOW_MARGIN_MIN,
  INJECTED_ACCURACY_M,
} from './demo-console.constants';
import {
  DEMO_PLACES,
  nearestPlaceIndex,
  shiftedSchedule,
} from './demo-trip.fixture';

/** 알림 대상 여행 상태 — 스캐너가 보는 상태와 같아야 시연이 성립한다. */
const ACTIVE_STATUSES = ['confirmed', 'in_progress'] as const;

/** 위도 1도당 거리(m). 이탈 위치를 "정북으로 n km" 로 만들 때만 쓰는 근사값. */
const METERS_PER_LAT_DEGREE = 111_320;

/**
 * 시연 콘솔 서비스.
 *
 * 발표에서 버튼 한 번에 "그 상황"을 만들기 위한 **조건 주입기**다. 미도착·날씨·혼잡 세
 * 시나리오 모두 알림을 직접 만들어 넣지 않는다 — 위치·예보·집중률이라는 입력만 주입하고,
 * 판정(임계값)·수신자 결정·중복 억제·인박스 저장·FCM 발송은 운영 스캐너가 그대로 한다.
 * 그래서 콘솔로 띄운 알림과 실제 여행 중 받는 알림은 같은 경로로 만들어진 같은 물건이다.
 *
 * 라우트는 `DEMO_CONSOLE_ENABLED` 가 켜진 환경에서만 등록된다(DemoConsoleModule).
 */
@Injectable()
export class DemoConsoleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DemoConsoleService.name);
  private readonly redis: Redis;

  constructor(
    @InjectRepository(TripEntity)
    private readonly tripsRepo: Repository<TripEntity>,
    @InjectRepository(ItineraryItemEntity)
    private readonly itemsRepo: Repository<ItineraryItemEntity>,
    @InjectRepository(TripMemberEntity)
    private readonly membersRepo: Repository<TripMemberEntity>,
    private readonly liveLocation: LiveLocationService,
    private readonly arrivalAlert: ArrivalAlertService,
    @Inject(DEMO_WEATHER_ALERT)
    private readonly weatherAlert: WeatherAlertService,
    @Inject(DEMO_CROWD_ALERT)
    private readonly crowdAlert: CrowdAlertService,
    private readonly forecastSource: DemoForecastSource,
    private readonly concentrationSource: DemoConcentrationSource,
    config: ConfigService,
  ) {
    this.redis = new Redis(
      redisConnection(config, { lazyConnect: true, maxRetriesPerRequest: 1 }),
    );
    this.redis.on('error', () => undefined);
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.redis.connect();
    } catch {
      // 연결 실패해도 부팅은 막지 않는다 — 중복 억제 키 해제만 degrade 된다.
    }
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }

  /**
   * 콘솔 상단에 띄우는 현재 상태 — 고를 수 있는 여행 목록, 선택된 여행의 대상 일차 일정,
   * 서버가 들고 있는 위치.
   *
   * `dto.tripId` 를 주면 그 여행을 보여준다 — 심사위원이 즉석에서 만든 여행에 시나리오를
   * 걸 수 있어야 하므로, 시드 여행은 "기본 선택"일 뿐 유일한 대상이 아니다.
   */
  async status(
    user: UserEntity,
    dto: DemoScenarioRequestDto = {},
    now: Date = new Date(),
  ): Promise<DemoConsoleStatusDto> {
    const trip = await this.findTrip(user, dto.tripId);
    const day = trip ? this.resolveDay(trip, dto.day, now) : null;

    return {
      user: { id: user.id, email: user.email ?? null, nickname: user.nickname },
      trip: trip && day ? await this.summarize(trip, day, now) : null,
      trips: await this.listTripOptions(user),
      location: await this.locationSummary(user, now),
    };
  }

  /**
   * 고를 수 있는 여행 목록. draft 처럼 스캐너가 보지 않는 상태도 함께 내려보낸다 —
   * 목록에서 감추면 "내 여행이 왜 없지" 가 되고, 실으면 화면이 이유를 먼저 보여줄 수 있다.
   */
  private async listTripOptions(user: UserEntity): Promise<DemoTripOptionDto[]> {
    const trips = (await this.visibleTrips(user)).slice(0, 20);

    return trips.map((trip) => ({
      tripId: trip.id,
      title: trip.title,
      startDate: trip.startDate,
      endDate: trip.endDate,
      days: countTripDays(trip.startDate, trip.endDate),
      status: trip.status,
      seeded: trip.userId === user.id && trip.title === DEMO_TRIP_TITLE,
      owned: trip.userId === user.id,
      scannable: ACTIVE_STATUSES.includes(trip.status as (typeof ACTIVE_STATUSES)[number]),
    }));
  }

  /**
   * 조작할 수 있는 여행: 내가 owner 인 것 + accepted 멤버로 참여 중인 것.
   *
   * 참여 여행까지 넣는 건 시연 때문이다 — 심사위원이 자기 계정으로 만든 여행에 발표자가
   * 조건을 걸려면 발표자가 그 여행의 참여자여야 하고, 그때 알림은 owner(심사위원) 기기에도
   * 간다. 여행 조회 권한(TripsService.findVisible)과 같은 기준이라 콘솔이 더 넓게 보지 않는다.
   */
  private async visibleTrips(user: UserEntity): Promise<TripEntity[]> {
    const owned = await this.tripsRepo.find({ where: { userId: user.id } });
    const memberRows = await this.membersRepo.find({
      where: { userId: user.id, status: 'accepted' },
    });
    const joinedIds = memberRows
      .map((row) => row.tripId)
      .filter((tripId) => !owned.some((trip) => trip.id === tripId));
    const joined =
      joinedIds.length > 0
        ? await this.tripsRepo.find({ where: joinedIds.map((id) => ({ id })) })
        : [];

    return [...owned, ...joined].sort((a, b) => b.startDate.localeCompare(a.startDate));
  }

  /**
   * 시연용 당일 여행을 만든다(같은 제목의 기존 시드는 지우고 다시 만든다 — 멱등).
   *
   * 시각표는 고정 시각이 아니라 **지금 기준**으로 옮겨 배치한다. 발표가 몇 시에 시작되든
   * 진행 중·완료·예정 항목이 자연스럽게 갈리고, 한 항목이 미도착 판정 창 안에 들어온다.
   */
  async seedTrip(user: UserEntity, now: Date = new Date()): Promise<DemoTripSummaryDto> {
    const iso = toKstIsoDate(now);
    const { hour, minute } = getKstParts(now);
    const anchorIndex = nearestPlaceIndex(hour * 60 + minute);
    const times = shiftedSchedule(anchorIndex, this.dueWindowInstant(now));

    await this.tripsRepo.delete({ userId: user.id, title: DEMO_TRIP_TITLE });

    const trip = await this.tripsRepo.save(
      this.tripsRepo.create({
        userId: user.id,
        title: DEMO_TRIP_TITLE,
        destination: '서울',
        startDate: iso,
        endDate: iso,
        status: 'in_progress',
        transportMode: 'transit',
        wakeTime: '08:00',
        sleepTime: '23:00',
        notes: '시연용 데이터 (시연 콘솔에서 생성)',
      }),
    );

    await this.itemsRepo.save(
      DEMO_PLACES.map((place, index) =>
        this.itemsRepo.create({
          tripId: trip.id,
          day: 1,
          order: index + 1,
          type: place.type,
          name: place.name,
          address: place.address,
          coordinates: { lat: place.lat, lng: place.lng },
          scheduledAt: times[index]!,
          durationMin: place.durationMin,
        }),
      ),
    );

    this.logger.warn(`[시연] 여행 시드 생성 — user ${user.id}, trip ${trip.id}`);
    return this.summarize(trip, 1, now);
  }

  /**
   * 미도착 시나리오 — "일정 시각인데 사용자가 그 장소에 없다" 를 만든다.
   *
   * 주입하는 것은 두 가지뿐이다: (1) 판정 창에 든 일정 항목, (2) 그 좌표에서 멀리 떨어진
   * 현재 위치. 판정(반경·정확도 마진·위치 신선도)과 발송은 운영 스캐너가 그대로 한다.
   */
  async runArrival(
    user: UserEntity,
    dto: DemoScenarioRequestDto,
    now: Date = new Date(),
  ): Promise<DemoScenarioResultDto> {
    const { trip, day, items } = await this.resolveTarget(user, dto, now);
    // 일정 시각을 옮기기 전에 막는다 — 스캐너가 보지 않는 여행이면 일정만 바뀌고 "0건" 으로 끝난다.
    this.assertActive(trip);
    const positioned = items.filter(
      (item) => item.coordinates?.lat != null && item.coordinates?.lng != null,
    );
    if (positioned.length === 0) {
      throw new BadRequestException(`${day}일차에 좌표가 있는 일정이 없어 판정할 수 없습니다.`);
    }

    // 이미 판정 창에 든 항목이 있으면 그대로 쓰고, 없을 때만 가장 가까운 항목의 시각을 옮긴다
    // (시각도 시연이 주입하는 조건이다 — 발표 중에 일정 시각이 자연히 도래하지는 않는다).
    const due = positioned.find((item) => this.isInDueWindow(item.scheduledAt, now));
    const target = due ?? (await this.moveIntoDueWindow(this.nearestItem(positioned, now), now));
    const shifted = !due;
    if (shifted && trip.userId !== user.id) {
      // 참여 중인 남의 여행은 일정 시각이 바뀐 걸 owner 가 알 길이 없다 — 최소한 로그엔 남긴다.
      this.logger.warn(
        `[시연] 참여 중인 여행의 일정 시각 이동 — trip ${trip.id}(owner ${trip.userId}), 조작 ${user.id}`,
      );
    }

    const distanceKm = dto.distanceKm ?? DEFAULT_DEVIATION_KM;
    await this.liveLocation.record(
      user.id,
      {
        lat: target.coordinates.lat + (distanceKm * 1000) / METERS_PER_LAT_DEGREE,
        lng: target.coordinates.lng,
        accuracy: INJECTED_ACCURACY_M,
      },
      now,
    );
    await this.clearKeys([arrivalDedupeKey(trip.id, user.id, day)]);

    // 정기 스캔(5분 주기)과 같은 호출이되 대상 여행으로 좁힌다 — 발표자 계정에 진행 중인
    // 여행이 여럿이면 주입한 위치 하나로 다른 여행까지 미도착이 잡혀 알림이 섞인다.
    const alerted = await this.arrivalAlert.scanDueItems(now, { tripIds: [trip.id] });

    return this.result('arrival', trip, alerted, [
      `${day}일차 '${target.name}'`,
      shifted ? `시각을 ${ARRIVAL_GRACE_MIN + DUE_WINDOW_MARGIN_MIN}분 전으로 이동` : '판정 창 진입',
      `현재 위치 ${distanceKm}km 밖(도착 반경 ${ARRIVAL_RADIUS_M}m)`,
    ]);
  }

  /** 날씨 시나리오 — 대상 일자에만 강수 예보를 물려 주고 운영 스캐너가 판정하게 한다. */
  async runWeather(
    user: UserEntity,
    dto: DemoScenarioRequestDto,
    now: Date = new Date(),
  ): Promise<DemoScenarioResultDto> {
    const { trip, day, iso, items } = await this.resolveTarget(user, dto, now);
    this.assertScannable(trip, iso, now, FORECAST_HORIZON_DAYS, '예보');
    this.assertHasType(items, WEATHER_SENSITIVE_TYPES, day, '야외(관광지) 일정');

    this.forecastSource.setRainyDates([iso.replace(/-/g, '')]);
    await this.clearKeys([weatherDedupeKey(trip.id, iso)]);
    const alerted = await this.weatherAlert.scanUpcomingTrips(now, { tripIds: [trip.id] });

    return this.result('weather', trip, alerted, [`${day}일차(${iso}) 강수 예보 주입`]);
  }

  /** 혼잡 시나리오 — 대상 일자의 집중률만 평소치 위로 올려 주고 판정은 운영 스캐너가 한다. */
  async runCrowd(
    user: UserEntity,
    dto: DemoScenarioRequestDto,
    now: Date = new Date(),
  ): Promise<DemoScenarioResultDto> {
    const { trip, day, iso, items } = await this.resolveTarget(user, dto, now);
    this.assertScannable(trip, iso, now, CONCENTRATION_HORIZON_DAYS, '집중률 예측');
    this.assertHasType(items, CROWD_SENSITIVE_TYPES, day, '관광지 일정');

    this.concentrationSource.setCrowdedDates(
      [iso.replace(/-/g, '')],
      toKstIsoDate(now).replace(/-/g, ''),
    );
    await this.clearKeys([crowdDedupeKey(trip.id, iso)]);
    const alerted = await this.crowdAlert.scanUpcomingTrips(now, { tripIds: [trip.id] });

    return this.result('crowd', trip, alerted, [`${day}일차(${iso}) 집중률 상승 주입`]);
  }

  /**
   * 리허설 흔적 정리 — 주입한 위치와 알림 중복 억제 키를 지운다.
   *
   * 시나리오 버튼은 각자 자기 억제 키를 풀고 돌기 때문에 여러 번 눌러도 매번 알림이 나간다.
   * 여기서 더 지우는 건 (1) 주입해 둔 가짜 위치 — 남겨 두면 정기 스캔이 그 위치로 계속
   * 미도착을 판정한다 — 와 (2) 정기 스캐너가 이미 선점해 둔 다른 일자의 키다.
   *
   * 키는 콘솔에서 **선택한 여행**(`dto.tripId`) 기준으로 지운다 — 기본 대상만 지우면 다른
   * 여행으로 리허설한 흔적이 그대로 남는다.
   */
  async reset(
    user: UserEntity,
    dto: DemoScenarioRequestDto = {},
    now: Date = new Date(),
  ): Promise<DemoConsoleStatusDto> {
    const trip = dto.tripId ? await this.requireTrip(user, dto.tripId) : await this.findTrip(user);
    const keys = [liveLocationKey(user.id)];

    if (trip) {
      const totalDays = countTripDays(trip.startDate, trip.endDate);
      for (let day = 1; day <= totalDays; day += 1) {
        const iso = addDaysToIsoDate(trip.startDate, day - 1);
        keys.push(
          arrivalDedupeKey(trip.id, user.id, day),
          weatherDedupeKey(trip.id, iso),
          crowdDedupeKey(trip.id, iso),
        );
      }
    }

    await this.clearKeys(keys);
    this.logger.warn(`[시연] 상태 초기화 — user ${user.id}, 키 ${keys.length}개`);
    return this.status(user, dto, now);
  }

  /** 대상 여행·일차·그 일차의 일정을 한 번에 해석한다. */
  private async resolveTarget(
    user: UserEntity,
    dto: DemoScenarioRequestDto,
    now: Date,
  ): Promise<{ trip: TripEntity; day: number; iso: string; items: ItineraryItemEntity[] }> {
    const trip = await this.requireTrip(user, dto.tripId);
    const day = this.resolveDay(trip, dto.day, now);
    const items = await this.itemsRepo.find({
      where: { tripId: trip.id, day },
      order: { order: 'ASC' },
    });
    if (items.length === 0) {
      throw new BadRequestException(`${day}일차에 일정이 없습니다. 먼저 일정을 만들어주세요.`);
    }
    return { trip, day, iso: addDaysToIsoDate(trip.startDate, day - 1), items };
  }

  /**
   * 시연 대상 여행: 명시한 여행 → 시드 여행 → 오늘 진행 중인 여행 → 가장 가까운 예정 여행 순.
   * 내가 owner 이거나 참여자(accepted)인 여행만 대상이다.
   */
  private async findTrip(user: UserEntity, tripId?: string): Promise<TripEntity | null> {
    const visible = await this.visibleTrips(user);
    if (tripId) {
      return visible.find((trip) => trip.id === tripId) ?? null;
    }

    const seeded = visible.find(
      (trip) => trip.userId === user.id && trip.title === DEMO_TRIP_TITLE,
    );
    if (seeded) return seeded;

    const today = toKstIsoDate();
    const active = visible.filter((trip) =>
      ACTIVE_STATUSES.includes(trip.status as (typeof ACTIVE_STATUSES)[number]),
    );
    const ongoing = active.find((trip) => trip.startDate <= today && trip.endDate >= today);
    if (ongoing) return ongoing;

    // 예정 여행 중에서는 가장 먼저 시작하는 것 — "다음 여행" 이 기본값으로 자연스럽다.
    return (
      active
        .filter((trip) => trip.endDate >= today)
        .sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ?? null
    );
  }

  private async requireTrip(user: UserEntity, tripId?: string): Promise<TripEntity> {
    const trip = await this.findTrip(user, tripId);
    if (!trip) {
      throw new NotFoundException(
        '시연 대상 여행이 없습니다. "시연용 여행 시드" 를 먼저 실행하거나 tripId 를 지정하세요.',
      );
    }
    return trip;
  }

  /** 대상 일차: 지정값 → 오늘이 여행 기간 안이면 그 일차 → 1일차. */
  private resolveDay(trip: TripEntity, day: number | undefined, now: Date): number {
    const totalDays = countTripDays(trip.startDate, trip.endDate);
    if (day !== undefined) {
      if (day > totalDays) {
        throw new BadRequestException(`이 여행은 ${totalDays}일차까지입니다.`);
      }
      return day;
    }

    const today = toKstIsoDate(now);
    for (let candidate = 1; candidate <= totalDays; candidate += 1) {
      if (addDaysToIsoDate(trip.startDate, candidate - 1) === today) return candidate;
    }
    return 1;
  }

  /** 세 스캐너 모두 확정·진행 중 여행만 본다 — 그 밖의 상태면 버튼을 누르자마자 이유를 알린다. */
  private assertActive(trip: TripEntity): void {
    if (!ACTIVE_STATUSES.includes(trip.status as (typeof ACTIVE_STATUSES)[number])) {
      throw new BadRequestException(
        `여행 상태가 '${trip.status}' 라 알림 대상이 아닙니다(확정 또는 진행 중이어야 합니다).`,
      );
    }
  }

  /**
   * 스캐너가 볼 수 있는 조건인지 먼저 확인한다 — 무대에서 "0건" 을 보고 원인을 찾는 대신,
   * 버튼을 누른 즉시 왜 안 되는지 알려준다.
   */
  private assertScannable(
    trip: TripEntity,
    iso: string,
    now: Date,
    horizonDays: number,
    horizonLabel: string,
  ): void {
    this.assertActive(trip);
    const today = toKstIsoDate(now);
    if (iso < today) {
      throw new BadRequestException('지난 일자는 알림 대상이 아닙니다. 오늘 이후 일차를 고르세요.');
    }
    // 스캐너는 예측 구간 밖 일자를 아예 조회하지 않는다 — 여기서 막지 않으면 "0건" 만 보고
    // 무대에서 원인을 찾게 된다.
    if (iso > addDaysToIsoDate(today, horizonDays)) {
      throw new BadRequestException(
        `${horizonLabel} 구간(오늘 +${horizonDays}일) 밖의 일자라 알림 대상이 아닙니다.`,
      );
    }
  }

  private assertHasType(
    items: ItineraryItemEntity[],
    types: ReadonlyArray<ItineraryItemEntity['type']>,
    day: number,
    label: string,
  ): void {
    if (!items.some((item) => types.includes(item.type))) {
      throw new BadRequestException(`${day}일차에 ${label}이 없어 이 알림은 발송되지 않습니다.`);
    }
  }

  /** 미도착 판정 창(시작+유예 ~ 지각 상한) 안의 시각인지. */
  private isInDueWindow(scheduledAt: Date, now: Date): boolean {
    const upper = now.getTime() - ARRIVAL_GRACE_MIN * 60_000;
    const lower = upper - ARRIVAL_LATE_LIMIT_MIN * 60_000;
    const at = scheduledAt.getTime();
    return at >= lower && at <= upper;
  }

  /** 판정 창 한가운데가 아니라 방금 들어온 지점 — 스캔이 곧바로 집어가는 시각. */
  private dueWindowInstant(now: Date): Date {
    return new Date(now.getTime() - (ARRIVAL_GRACE_MIN + DUE_WINDOW_MARGIN_MIN) * 60_000);
  }

  private nearestItem(items: ItineraryItemEntity[], now: Date): ItineraryItemEntity {
    return items.reduce((best, item) =>
      Math.abs(item.scheduledAt.getTime() - now.getTime()) <
      Math.abs(best.scheduledAt.getTime() - now.getTime())
        ? item
        : best,
    );
  }

  private async moveIntoDueWindow(
    item: ItineraryItemEntity,
    now: Date,
  ): Promise<ItineraryItemEntity> {
    item.scheduledAt = this.dueWindowInstant(now);
    return this.itemsRepo.save(item);
  }

  private async locationSummary(user: UserEntity, now: Date) {
    // 신선도 판정 결과가 아니라 "얼마나 오래됐는지" 를 보여주려는 것이라 TTL 만큼 넉넉히 읽는다.
    const loc = await this.liveLocation.getFresh(user.id, LOCATION_TTL_SEC * 1000, now);
    if (!loc) return null;
    const ageMs = now.getTime() - loc.ts;
    return {
      lat: loc.lat,
      lng: loc.lng,
      ageSec: Math.max(0, Math.round(ageMs / 1000)),
      fresh: ageMs <= LOCATION_STALE_MS,
    };
  }

  private async summarize(
    trip: TripEntity,
    day: number,
    now: Date,
  ): Promise<DemoTripSummaryDto> {
    const items = await this.itemsRepo.find({
      where: { tripId: trip.id, day },
      order: { order: 'ASC' },
    });

    return {
      tripId: trip.id,
      title: trip.title,
      date: addDaysToIsoDate(trip.startDate, day - 1),
      day,
      items: items.map((item): DemoItemSummaryDto => {
        const { hour, minute } = getKstParts(item.scheduledAt);
        return {
          id: item.id,
          name: item.name,
          type: item.type,
          time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
          arrivalDue: this.isInDueWindow(item.scheduledAt, now),
        };
      }),
    };
  }

  private result(
    scenario: DemoScenario,
    trip: TripEntity,
    alerted: number,
    notes: string[],
  ): DemoScenarioResultDto {
    const detail = `${notes.join(' · ')} → 알림 ${alerted}건 발송`;
    this.logger.warn(`[시연] ${scenario} — ${detail} (trip ${trip.id})`);
    return { scenario, tripId: trip.id, alerted, detail };
  }

  /** 중복 억제 키·주입 위치 삭제. Redis 장애 시 조용히 넘어간다(시연 흐름을 막지 않는다). */
  private async clearKeys(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await this.redis.del(...keys);
    } catch {
      this.logger.warn('[시연] Redis 키 정리 실패 — 중복 억제가 남아 있을 수 있습니다.');
    }
  }
}
