import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Redis } from 'ioredis';
import type { Coordinates } from '@tripick/types';

interface EtaResult {
  durationSec: number;
  distanceM: number;
}

const REQUEST_TIMEOUT_MS = 10_000;

/** 카카오 모빌리티 result_code: 출발지와 도착지가 5m 이내. 경로가 아니라 "이동 없음"이 정답이다. */
const KAKAO_TOO_CLOSE = 104;

/**
 * 카카오 모빌리티는 실시간 교통을 반영하므로 오래 캐싱하면 그 값이 무의미해진다.
 * 반대로 ODsay 는 시간표 기반이라 하루 내내 같은 값이다. 그래서 TTL 을 나눈다.
 */
const CACHE_TTL_SEC: Record<'car' | 'transit', number> = {
  car: 60 * 60,
  transit: 12 * 60 * 60,
};

/** 좌표 캐시 키 자릿수. 5자리 ≈ 1m — 부동소수 잡음만 흡수하고 다른 장소는 섞지 않는다. */
const COORD_PRECISION = 5;

@Injectable()
export class RouteHelper implements OnModuleDestroy {
  private readonly logger = new Logger(RouteHelper.name);
  /** 설정 누락 warn 은 일정당 좌표쌍마다 반복되므로 키별로 1회만 남긴다. */
  private readonly warnedKeys = new Set<string>();
  private readonly redis: Redis;

  constructor(private readonly config: ConfigService) {
    this.redis = new Redis({
      host: this.config.get<string>('REDIS_HOST', 'localhost'),
      port: this.config.get<number>('REDIS_PORT', 6379),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    // Redis 미가동 시에도 ETA 조회 자체는 실패하면 안 되므로 에러를 삼킨다.
    this.redis.on('error', () => undefined);
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }

  private warnOnce(key: string, message: string): void {
    if (this.warnedKeys.has(key)) return;
    this.warnedKeys.add(key);
    this.logger.warn(message);
  }

  private buildCacheKey(from: Coordinates, to: Coordinates, mode: 'car' | 'transit'): string {
    const at = (c: Coordinates) =>
      `${c.lat.toFixed(COORD_PRECISION)},${c.lng.toFixed(COORD_PRECISION)}`;
    return `route:eta:${mode}:${at(from)}:${at(to)}`;
  }

  private async readCache(key: string): Promise<EtaResult | null> {
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as EtaResult;
    } catch {
      return null;
    }
  }

  /**
   * 외부 API 가 실제로 답한 값만 저장한다. 폴백 추정치를 캐싱하면 API 장애가
   * 지나간 뒤에도 나쁜 값이 TTL 동안 박제되므로 호출부에서 폴백은 넘기지 않는다.
   */
  private async writeCache(key: string, eta: EtaResult, ttlSec: number): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(eta), 'EX', ttlSec);
    } catch {
      // 캐시 실패는 ETA 조회 성공을 막지 않는다.
    }
  }

  async getDrivingEta(from: Coordinates, to: Coordinates): Promise<EtaResult> {
    const apiKey = this.config.get<string>('KAKAO_REST_API_KEY', '');
    if (!apiKey) {
      this.warnOnce('KAKAO_REST_API_KEY', 'KAKAO_REST_API_KEY 미설정 — 자동차 ETA 를 로컬 추정치로 대체합니다.');
      return this.buildLocalEstimate(from, to, 28);
    }

    const cacheKey = this.buildCacheKey(from, to, 'car');
    const cached = await this.readCache(cacheKey);
    if (cached) return cached;

    try {
      const res = await axios.get<{
        routes: Array<{
          result_code: number;
          result_msg: string;
          summary?: { distance: number; duration: number };
        }>;
      }>('https://apis-navi.kakaomobility.com/v1/directions', {
        params: {
          origin: `${from.lng},${from.lat}`,
          destination: `${to.lng},${to.lat}`,
          priority: 'RECOMMEND',
        },
        headers: { Authorization: `KakaoAK ${apiKey}` },
        timeout: REQUEST_TIMEOUT_MS,
      });

      const route = res.data.routes?.[0];
      if (!route) {
        this.logger.error('카카오 모빌리티 경로 없음 — 로컬 추정치로 대체합니다.');
        return this.buildLocalEstimate(from, to, 28);
      }

      // 길찾기 실패는 HTTP 200 + result_code 로 온다. 던지지 않으므로 직접 본다.
      if (route.result_code === KAKAO_TOO_CLOSE) {
        const zero = { durationSec: 0, distanceM: 0 };
        await this.writeCache(cacheKey, zero, CACHE_TTL_SEC.car);
        return zero;
      }
      if (route.result_code !== 0 || !route.summary) {
        this.logger.error(
          `카카오 모빌리티 길찾기 실패 (${route.result_code}: ${route.result_msg}) — 로컬 추정치로 대체합니다.`,
        );
        return this.buildLocalEstimate(from, to, 28);
      }

      // summary.duration=초, summary.distance=미터. 변환 없이 그대로 쓴다.
      const eta = { durationSec: route.summary.duration, distanceM: route.summary.distance };
      await this.writeCache(cacheKey, eta, CACHE_TTL_SEC.car);
      return eta;
    } catch (err) {
      this.logger.error('카카오 모빌리티 ETA 조회 실패:', err);
      return this.buildLocalEstimate(from, to, 28);
    }
  }

  async getTransitEta(from: Coordinates, to: Coordinates): Promise<EtaResult> {
    const apiKey = this.config.get<string>('ODSAY_API_KEY', '');
    if (!apiKey) {
      this.warnOnce('ODSAY_API_KEY', 'ODSAY_API_KEY 미설정 — 대중교통 ETA 를 로컬 추정치로 대체합니다.');
      return this.buildLocalEstimate(from, to, 20);
    }

    // ODsay 는 발급 시 등록한 서비스 URL 을 Referer 로 검증한다. 헤더가 없으면 무조건 ApiKeyAuthFailed.
    const serviceUrl = this.config.get<string>('ODSAY_SERVICE_URL', '');
    if (!serviceUrl) {
      this.warnOnce(
        'ODSAY_SERVICE_URL',
        'ODSAY_SERVICE_URL 미설정 — ODsay 인증이 실패하므로 로컬 추정치로 대체합니다.',
      );
      return this.buildLocalEstimate(from, to, 20);
    }

    const cacheKey = this.buildCacheKey(from, to, 'transit');
    const cached = await this.readCache(cacheKey);
    if (cached) return cached;

    try {
      const res = await axios.get<{
        error?: Array<{ code: string; message: string }>;
        result?: { path?: Array<{ info: { totalTime: number; totalDistance: number } }> };
      }>('https://api.odsay.com/v1/api/searchPubTransPathT', {
        params: {
          apiKey,
          SX: from.lng,
          SY: from.lat,
          EX: to.lng,
          EY: to.lat,
        },
        headers: { Referer: serviceUrl },
        timeout: REQUEST_TIMEOUT_MS,
      });

      // ODsay 는 인증 실패·경로 없음도 HTTP 200 + error 배열로 준다.
      const error = res.data.error?.[0];
      if (error) {
        this.logger.error(
          `ODsay 길찾기 실패 (${error.code}: ${error.message}) — 로컬 추정치로 대체합니다.`,
        );
        return this.buildLocalEstimate(from, to, 20);
      }

      const info = res.data.result?.path?.[0]?.info;
      if (!info) {
        this.logger.error('ODsay 경로 없음 — 로컬 추정치로 대체합니다.');
        return this.buildLocalEstimate(from, to, 20);
      }

      // totalTime=분, totalDistance=미터. 시간만 초로 바꾼다.
      const eta = { durationSec: info.totalTime * 60, distanceM: info.totalDistance };
      await this.writeCache(cacheKey, eta, CACHE_TTL_SEC.transit);
      return eta;
    } catch (err) {
      this.logger.error('ODsay ETA 조회 실패:', err);
      return this.buildLocalEstimate(from, to, 20);
    }
  }

  private buildLocalEstimate(from: Coordinates, to: Coordinates, kmPerHour: number): EtaResult {
    const distanceKm = this.getDistanceKm(from, to);
    return {
      distanceM: Math.round(distanceKm * 1000),
      durationSec: Math.max(600, Math.round((distanceKm / kmPerHour) * 3600)),
    };
  }

  private getDistanceKm(from: Coordinates, to: Coordinates): number {
    const latDelta = (from.lat - to.lat) * 111;
    const lngDelta = (from.lng - to.lng) * 88;
    return Math.sqrt(latDelta ** 2 + lngDelta ** 2);
  }
}
