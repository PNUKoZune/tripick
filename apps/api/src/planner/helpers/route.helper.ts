import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Redis } from 'ioredis';
import { haversineMeters } from '@tripick/utils';
import type { Coordinates, RouteEtaSource, RouteTransportMode } from '@tripick/types';

interface EtaResult {
  durationSec: number;
  distanceM: number;
  source: RouteEtaSource;
}

interface OtpPlanResponse {
  data?: {
    plan?: {
      itineraries?: Array<{
        duration: number;
        legs: Array<{ distance: number | null }>;
      }>;
    };
  };
  errors?: Array<{ message: string }>;
}

/**
 * OTP 는 서비스 날짜별 transit 레이어를 lazy 로 만들어, 특정 날짜의 첫 질의가 ~1.8초
 * (같은 날짜 재질의는 ~0.9초)다. 평소엔 여유가 크지만, 힙이 부족하면 GC 가 폭주해 같은
 * 질의가 수십 초까지 늘어난다(compose 의 OTP 힙 주석 참고). 그때 폴백 추정치를 조용히
 * 내보내느니 조금 더 기다리는 편이 나아 여유를 크게 잡는다.
 */
const OTP_TIMEOUT_MS = 15_000;

/** 교통수단별 OTP transportModes 인자. */
const MODE_QUERY: Record<RouteTransportMode, string> = {
  car: '[{ mode: CAR }]',
  transit: '[{ mode: TRANSIT }, { mode: WALK }]',
  walk: '[{ mode: WALK }]',
};

/** OTP 미가동 시 폴백 추정에 쓰는 평균 속도(km/h). */
const MODE_FALLBACK_KMH: Record<RouteTransportMode, number> = {
  car: 28,
  transit: 20,
  walk: 4.5,
};

/**
 * OTP 는 CAR/WALK 를 시간과 무관하게(교통량 모델 없음) 계산하므로 캐시 키에서 시각을 뺀다.
 * TRANSIT 만 시간표에 의존해 출발 시각이 키에 들어간다.
 */
const TIME_DEPENDENT: Record<RouteTransportMode, boolean> = {
  car: false,
  transit: true,
  walk: false,
};

/**
 * OTP2(OpenTripPlanner) GraphQL 로 두 좌표 간 경로 ETA 를 조회한다.
 * 자동차(CAR)·대중교통(TRANSIT+WALK)·도보(WALK) 를 동일 그래프에서 처리한다.
 *
 * - OTP 미가동·경로 없음·오류 시 직선거리 로컬 추정으로 폴백 (source='estimate')
 * - departAt 이 있는 질의는 결과가 결정적이라 Redis 에 캐싱한다. 일정 생성 1건이
 *   같은 구간을 여러 번(제약 검증 재시도 등) 조회하므로 적중률이 높다.
 */
@Injectable()
export class RouteHelper implements OnModuleDestroy {
  private readonly logger = new Logger(RouteHelper.name);
  /** OTP_BASE_URL 미설정 warn 을 1회로 제한하기 위한 플래그. */
  private warnedNoOtp = false;
  /** 같은 그래프면 (출발지·도착지·수단·출발시각) 결과가 결정적이라 길게 잡는다. */
  private readonly CACHE_TTL_SEC = 6 * 60 * 60;
  private readonly redis: Redis;

  constructor(private readonly config: ConfigService) {
    this.redis = new Redis({
      host: this.config.get<string>('REDIS_HOST', 'localhost'),
      port: this.config.get<number>('REDIS_PORT', 6379),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    // Redis 미가동 시에도 경로 조회 자체는 실패하면 안 되므로 에러를 삼킨다.
    this.redis.on('error', () => undefined);
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }

  /**
   * @param departAt 계획상 출발 시각. 대중교통은 시간표 기반이라 이 값이 없으면
   *   "현재 시각"으로 계산돼 밤/새벽엔 배차가 없어 왜곡되므로, 호출부에서 넘겨야 정확하다.
   */
  async getDrivingEta(from: Coordinates, to: Coordinates, departAt?: Date): Promise<EtaResult> {
    return this.getEta(from, to, 'car', departAt);
  }

  async getTransitEta(from: Coordinates, to: Coordinates, departAt?: Date): Promise<EtaResult> {
    return this.getEta(from, to, 'transit', departAt);
  }

  async getWalkingEta(from: Coordinates, to: Coordinates, departAt?: Date): Promise<EtaResult> {
    return this.getEta(from, to, 'walk', departAt);
  }

  /** 교통수단 값으로 경로를 조회한다. 표시용 라벨이 아닌 정본 mode 를 받는다. */
  async getEta(
    from: Coordinates,
    to: Coordinates,
    mode: RouteTransportMode,
    departAt?: Date,
  ): Promise<EtaResult> {
    const cacheKey = this.buildCacheKey(from, to, mode, departAt);

    if (cacheKey) {
      const cached = await this.readCache(cacheKey);
      if (cached) return cached;
    }

    const eta = await this.queryOtp(from, to, mode, departAt);

    // 폴백 추정치는 캐싱하지 않는다 — OTP 장애가 지나가도 나쁜 값이 TTL 동안 박제된다.
    if (cacheKey && eta.source === 'otp') {
      await this.writeCache(cacheKey, eta);
    }
    return eta;
  }

  /**
   * 캐시 키. 캐싱하면 안 되는 질의는 null 을 반환한다.
   *
   * departAt 이 없으면 OTP 가 "현재 시각"으로 계산하므로 결과가 벽시계에 의존한다.
   * 이걸 캐싱하면 Live 폴링이 갱신되지 않고 얼어붙으므로 캐싱 대상에서 제외한다
   * (시간 비의존 수단인 car/walk 는 현재 위치가 매번 달라 어차피 적중률이 없다).
   */
  private buildCacheKey(
    from: Coordinates,
    to: Coordinates,
    mode: RouteTransportMode,
    departAt?: Date,
  ): string | null {
    if (!departAt) return null;
    const at = TIME_DEPENDENT[mode] ? departAt.toISOString().slice(0, 16) : 'any';
    return `route:eta:${mode}:${this.coordKey(from)}:${this.coordKey(to)}:${at}`;
  }

  /** 부동소수 잡음으로 키가 갈리지 않게 소수 5자리(~1m)로 정규화. */
  private coordKey({ lat, lng }: Coordinates): string {
    return `${lat.toFixed(5)},${lng.toFixed(5)}`;
  }

  /** 캐시된 ETA 복원. 미스/장애 시 null 을 반환해 실호출로 넘긴다. */
  private async readCache(key: string): Promise<EtaResult | null> {
    try {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as EtaResult) : null;
    } catch {
      return null;
    }
  }

  /** ETA 를 TTL 과 함께 저장. 장애 시 조용히 무시한다. */
  private async writeCache(key: string, eta: EtaResult): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(eta), 'EX', this.CACHE_TTL_SEC);
    } catch {
      // 캐시 실패는 경로 조회 성공을 막지 않는다.
    }
  }

  /** OTP GraphQL plan 질의. 실패하면 수단별 평균 속도로 로컬 추정. */
  private async queryOtp(
    from: Coordinates,
    to: Coordinates,
    mode: RouteTransportMode,
    departAt?: Date,
  ): Promise<EtaResult> {
    const modes = MODE_QUERY[mode];
    const fallbackKmPerHour = MODE_FALLBACK_KMH[mode];
    const baseUrl = this.config.get<string>('OTP_BASE_URL', 'http://localhost:8090');
    if (!baseUrl) {
      // 매 호출 warn 은 로그를 덮으므로 1회만 — 폴백이 조용히 상시화되는 것만 막는다.
      if (!this.warnedNoOtp) {
        this.warnedNoOtp = true;
        this.logger.warn(
          'OTP_BASE_URL 미설정 — 모든 ETA 가 직선거리 추정치(source=estimate)로 응답됩니다.',
        );
      }
      return this.buildLocalEstimate(from, to, fallbackKmPerHour);
    }

    // OTP 는 그래프 타임존(Asia/Seoul) 기준 벽시계 date/time 을 받는다.
    const departArgs = departAt
      ? `date: "${this.kstDate(departAt)}", time: "${this.kstTime(departAt)}", `
      : '';

    const query = `{
      plan(
        from: { lat: ${from.lat}, lon: ${from.lng} },
        to: { lat: ${to.lat}, lon: ${to.lng} },
        ${departArgs}transportModes: ${modes},
        numItineraries: 1
      ) {
        itineraries { duration legs { distance } }
      }
    }`;

    try {
      const res = await axios.post<OtpPlanResponse>(
        `${baseUrl}/otp/gtfs/v1`,
        { query },
        { headers: { 'Content-Type': 'application/json' }, timeout: OTP_TIMEOUT_MS },
      );

      if (res.data.errors?.length) {
        this.logger.warn(`OTP GraphQL 오류: ${res.data.errors[0]?.message} — 로컬 추정으로 폴백`);
        return this.buildLocalEstimate(from, to, fallbackKmPerHour);
      }

      const itinerary = res.data.data?.plan?.itineraries?.[0];
      if (!itinerary) {
        this.logger.warn('OTP 경로 없음 — 로컬 추정으로 폴백');
        return this.buildLocalEstimate(from, to, fallbackKmPerHour);
      }

      const distanceM = itinerary.legs.reduce((sum, leg) => sum + (leg.distance ?? 0), 0);
      return {
        durationSec: Math.round(itinerary.duration),
        distanceM: Math.round(distanceM),
        source: 'otp',
      };
    } catch (err) {
      this.logger.error('OTP ETA 조회 실패:', err);
      return this.buildLocalEstimate(from, to, fallbackKmPerHour);
    }
  }

  /** 직선거리 기반 폴백 추정. 실경로가 아니므로 source=estimate 로 표시한다. */
  private buildLocalEstimate(from: Coordinates, to: Coordinates, kmPerHour: number): EtaResult {
    const distanceKm = haversineMeters(from, to) / 1000;
    return {
      distanceM: Math.round(distanceKm * 1000),
      durationSec: Math.max(600, Math.round((distanceKm / kmPerHour) * 3600)),
      source: 'estimate',
    };
  }

  /** Date → Asia/Seoul 기준 YYYY-MM-DD. */
  private kstDate(date: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }

  /** Date → Asia/Seoul 기준 HH:mm. */
  private kstTime(date: Date): string {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  }
}
