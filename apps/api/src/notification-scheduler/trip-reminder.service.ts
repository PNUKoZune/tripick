import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Redis } from 'ioredis';
import { In, Repository } from 'typeorm';
import { TripEntity } from '../trips/trip.entity';
import { InboxService } from '../inbox/inbox.service';
import { TripMembersService } from '../trip-members/trip-members.service';
import { getKstParts } from '@tripick/utils';
import { MIN_DEDUPE_TTL_SEC } from './notification-scheduler.constants';

/** 리마인더 한 종류. 출발 전날(d1) / 출발 당일(dday). */
type ReminderKind = 'd1' | 'dday';

/**
 * 트립 리마인더 스캐너.
 *
 * 출발 전날(D-1)·당일(D-day) 아침에 여행 멤버 전원에게 "여행이 곧 시작해요" 인박스
 * 알림을 보낸다. 자동 재계획 같은 동작은 없고 리마인더뿐이다.
 * (인박스의 trip_reminder 는 open-trip 액션으로 /planner 로 이동한다.)
 */
@Injectable()
export class TripReminderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TripReminderService.name);
  private readonly redis: Redis;

  constructor(
    @InjectRepository(TripEntity)
    private readonly tripsRepo: Repository<TripEntity>,
    private readonly inboxService: InboxService,
    private readonly tripMembersService: TripMembersService,
    config: ConfigService,
  ) {
    // Redis 가 죽어도 스캔은 굴러가야 하므로 에러는 삼킨다. 다만 여기 쓰기는 캐시가
    // 아니라 중복 알림 억제 기록이라, 연결 전 유실을 막으려 offline queue 는 켜 둔다.
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
   * 오늘(KST) 출발하거나 내일 출발하는 확정 여행을 훑어 리마인더를 보낸다.
   * 한 여행의 실패가 나머지 스캔을 막지 않는다.
   *
   * @returns 알림을 보낸 (여행, 리마인더 종류) 건수
   */
  async scanUpcomingTrips(now: Date = new Date()): Promise<number> {
    const today = this.kstToday(now);
    const tomorrow = this.addDaysIso(today, 1);

    // startDate 가 오늘(D-day) 또는 내일(D-1)인 여행만 대상.
    const trips = await this.tripsRepo.find({
      where: {
        status: In(['confirmed', 'in_progress']),
        startDate: In([today, tomorrow]),
      },
    });
    if (trips.length === 0) {
      this.logger.log('오늘·내일 출발하는 여행 없음 — 리마인더 스캔 종료');
      return 0;
    }

    this.logger.log(`리마인더 스캔 시작 — 대상 여행 ${trips.length}건`);
    let alerted = 0;
    for (const trip of trips) {
      try {
        const kind: ReminderKind = trip.startDate === today ? 'dday' : 'd1';
        alerted += await this.remind(trip, kind, now);
      } catch (err) {
        this.logger.error(`여행 ${trip.id} 리마인더 발송 실패:`, err);
      }
    }
    this.logger.log(`리마인더 스캔 완료 — 알림 ${alerted}건 발송`);
    return alerted;
  }

  /** 여행 1건에 리마인더 1종을 보낸다. 발송했으면 1, 스킵했으면 0. */
  private async remind(trip: TripEntity, kind: ReminderKind, now: Date): Promise<number> {
    const { userIds } = await this.tripMembersService.getNotificationTargets(trip.id);
    if (userIds.length === 0) return 0;

    // 발송 전에 중복 억제 키를 선점한다 — 발송 후에 기록하면 잡 재시도가 같은 알림을
    // 다시 보낸다. (여행, 종류)당 1회만 나간다.
    if (!(await this.claimReminder(trip.id, kind, now))) return 0;

    const label = trip.title || '여행';
    const isDday = kind === 'dday';
    const title = isDday ? `🧳 오늘 "${label}" 출발!` : `🧳 내일 "${label}" 출발`;
    const body = isDday
      ? `오늘부터 "${label}"(${trip.destination}) 여행이 시작돼요. 즐거운 여행 되세요!`
      : `내일(${trip.startDate}) "${label}"(${trip.destination}) 여행이 시작돼요. 일정을 미리 확인해 보세요.`;

    await Promise.all(
      userIds.map((userId) =>
        this.inboxService.create({
          userId,
          category: 'trip_reminder',
          title,
          body,
          payload: { tripId: trip.id, kind },
        }),
      ),
    );
    return 1;
  }

  /**
   * (여행, 리마인더 종류) 발송 권한을 SET NX 로 원자적으로 선점한다.
   * TTL 이 오늘(KST) 끝까지라 하루 안에 잡이 재시도돼도 중복 발송하지 않는다.
   * Redis 장애 시 true — 중복될 수는 있어도 누락되지는 않게 한다.
   */
  private async claimReminder(tripId: string, kind: ReminderKind, now: Date): Promise<boolean> {
    try {
      const res = await this.redis.set(
        `trip:reminder:sent:${tripId}:${kind}`,
        '1',
        'EX',
        this.endOfTodayTtlSec(now),
        'NX',
      );
      return res === 'OK';
    } catch {
      return true;
    }
  }

  /** 오늘(KST)이 끝날 때까지 남은 초. 서버 TZ 와 무관하게 KST 자정 기준으로 계산한다. */
  private endOfTodayTtlSec(now: Date): number {
    const tomorrow = this.addDaysIso(this.kstToday(now), 1);
    const endOfDayKst = Date.parse(`${tomorrow}T00:00:00+09:00`);
    const remainSec = Math.ceil((endOfDayKst - now.getTime()) / 1000);
    return Math.max(remainSec, MIN_DEDUPE_TTL_SEC);
  }

  /** 오늘(KST)을 YYYY-MM-DD 로 반환한다. */
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
