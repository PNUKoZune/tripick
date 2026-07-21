import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { LOCATION_TTL_SEC } from './arrival-alert.constants';

/** 서버에 보관되는 사용자 최신 위치 1건. */
export interface LiveLocation {
  lat: number;
  lng: number;
  accuracy?: number;
  /** 보고 수신 시각(epoch ms) — 신선도 판정에 사용 */
  ts: number;
}

/**
 * 여행 진행 중 사용자의 최신 위치를 Redis 에 캐시하고, 미도착 알림 중복 억제 키를 관리한다.
 *
 * 위치는 판정용 휘발 데이터라 DB 가 아니라 Redis 에 짧은 TTL 로만 둔다(개인정보 최소 보관).
 * Redis 가 죽어도 부팅·인제스트는 막지 않는다 — 위치가 없으면 스캔이 그 사용자를 건너뛸 뿐이다.
 */
@Injectable()
export class LiveLocationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LiveLocationService.name);
  private readonly redis: Redis;

  constructor(config: ConfigService) {
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
      // 연결 실패 시에도 부팅은 막지 않는다 — 위치 인제스트·판정만 degrade 된다.
    }
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }

  /** 사용자 최신 위치를 TTL 과 함께 저장한다. Redis 장애 시 조용히 무시. */
  async record(userId: string, loc: Omit<LiveLocation, 'ts'>, now: Date = new Date()): Promise<void> {
    const value: LiveLocation = {
      lat: loc.lat,
      lng: loc.lng,
      ...(loc.accuracy !== undefined ? { accuracy: loc.accuracy } : {}),
      ts: now.getTime(),
    };
    try {
      await this.redis.set(this.locationKey(userId), JSON.stringify(value), 'EX', LOCATION_TTL_SEC);
    } catch {
      // 위치 캐시 실패는 다음 보고에서 복구된다.
    }
  }

  /**
   * 사용자 최신 위치를 반환하되, 마지막 보고가 maxAgeMs 보다 오래됐으면 null.
   * 위치가 없거나 오래됐으면 판정 불가로 보고 호출자가 건너뛴다.
   */
  async getFresh(userId: string, maxAgeMs: number, now: Date = new Date()): Promise<LiveLocation | null> {
    let raw: string | null;
    try {
      raw = await this.redis.get(this.locationKey(userId));
    } catch {
      return null;
    }
    if (!raw) return null;
    try {
      const loc = JSON.parse(raw) as LiveLocation;
      if (now.getTime() - loc.ts > maxAgeMs) return null;
      return loc;
    } catch {
      return null;
    }
  }

  /**
   * 미도착 알림 발송 권한을 SET NX 로 원자적으로 선점한다. 이미 선점됐으면 false.
   * ttlSec 은 호출자가 "그 일자가 끝날 때까지"로 계산해 넘긴다.
   * Redis 장애 시 true — 누락보다 중복을 택한다(잡음은 dedup 실패보다 낫다는 판단).
   */
  async claimAlert(tripId: string, userId: string, day: number, ttlSec: number): Promise<boolean> {
    try {
      const res = await this.redis.set(
        this.dedupeKey(tripId, userId, day),
        '1',
        'EX',
        ttlSec,
        'NX',
      );
      return res === 'OK';
    } catch {
      return true;
    }
  }

  private locationKey(userId: string): string {
    return `live:location:${userId}`;
  }

  private dedupeKey(tripId: string, userId: string, day: number): string {
    return `arrival:alert:sent:${tripId}:${userId}:${day}`;
  }
}
