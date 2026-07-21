import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Redis } from 'ioredis';
import type { Coordinates, RouteMode } from '@tripick/types';

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
 * walk 는 외부 API 를 타지 않아 캐싱 대상이 아니다.
 */
const CACHE_TTL_SEC: Record<'car' | 'transit', number> = {
  car: 60 * 60,
  transit: 12 * 60 * 60,
};

/** 좌표 캐시 키 자릿수. 5자리 ≈ 1m — 부동소수 잡음만 흡수하고 다른 장소는 섞지 않는다. */
const COORD_PRECISION = 5;

/**
 * 직선거리에 적용하는 실효 속도(km/h). 실제 경로는 직선보다 우회하므로 실주행 속도보다 낮다.
 * walk 는 도보 4.5km/h 에 우회 1.3배를 반영한 값으로, 폴백이 아니라 정식 추정 모델이다
 * (도보 경로를 주는 국내 API 가 마땅치 않아 로컬 추정으로 간다).
 */
const EFFECTIVE_KMH: Record<RouteMode, number> = {
  car: 28,
  transit: 20,
  walk: 3.5,
};

/**
 * 로컬 추정의 최소 이동시간(초). API 가 없어 거리만 아는 폴백에는 보수적으로 10분을 깔지만,
 * walk 는 거리 기반 추정 자체가 정답이라 바닥만 막는다.
 */
const MIN_DURATION_SEC: Record<RouteMode, number> = {
  car: 600,
  transit: 600,
  walk: 60,
};

/**
 * 외부 API 대신 로컬 추정치로 떨어진 사유. 폴백은 실패를 조용히 삼키므로(문서 3절),
 * 왜 떨어졌는지를 이동수단·사유별로 계수해 지표로 남긴다. 특히 ODsay 무료 플랜 쿼터
 * 초과는 코드 500 계열(`quota_or_server`)로 오는데, 폴백이 삼키면 한도 초과를 모른 채
 * 추정치가 계속 나가므로 이 버킷의 급증이 곧 쿼터 초과 신호다.
 */
type RouteFallbackReason =
  | 'no_key' // API 키 미설정 (배포 미스컨피그)
  | 'no_service_url' // ODSAY_SERVICE_URL 미설정 — Referer 없이는 무조건 인증 실패
  | 'auth_failed' // ODsay 500 + [ApiKeyAuthFailed]
  | 'quota_or_server' // ODsay 500 기타 — 무료 플랜 쿼터 초과가 여기로 온다
  | 'bad_request' // ODsay -8/-9 (필수 입력값 형식/누락)
  | 'no_station' // ODsay 3/4/5 (출·도착 정류장 없음)
  | 'out_of_area' // ODsay 6 (서비스 지역 아님)
  | 'too_close' // ODsay -98 (출·도착 700m 이내)
  | 'no_route' // ODsay -99 / 카카오 경로 없음 / 빈 응답
  | 'api_error' // 카카오 result_code != 0 (104 제외)
  | 'network'; // axios throw / 타임아웃

/**
 * "정상적인 라우팅 결과"인 폴백. 우리 잘못이나 장애가 아니라 그 구간에 경로가 없거나
 * 너무 가까운 경우라 warn 으로 시끄럽게 알리지 않는다. 나머지(쿼터·인증·네트워크·미스컨피그)만
 * 주의가 필요한 이상 신호로 본다. 계수는 두 부류 모두 남긴다.
 */
const EXPECTED_FALLBACK: ReadonlySet<RouteFallbackReason> = new Set<RouteFallbackReason>([
  'too_close',
  'no_route',
  'no_station',
  'out_of_area',
]);

/**
 * ODsay error[] 코드를 폴백 사유로 매핑한다. 코드는 문자열로 온다.
 * 500 은 인증 실패·쿼터 초과·순수 서버 오류가 모두 섞여 오는 버킷이라, 메시지의
 * `[ApiKeyAuthFailed]` 마커로 인증만 갈라내고 나머지는 `quota_or_server` 로 둔다
 * (쿼터 초과가 여기로 오며, raw 메시지는 fallback 로그에 그대로 남는다).
 */
function classifyOdsayError(code: string, message: string): RouteFallbackReason {
  switch (code) {
    case '500':
      return /ApiKeyAuthFailed/i.test(message) ? 'auth_failed' : 'quota_or_server';
    case '-8':
    case '-9':
      return 'bad_request';
    case '3':
    case '4':
    case '5':
      return 'no_station';
    case '6':
      return 'out_of_area';
    case '-98':
      return 'too_close';
    case '-99':
      return 'no_route';
    default:
      return 'quota_or_server';
  }
}

@Injectable()
export class RouteHelper implements OnModuleDestroy {
  private readonly logger = new Logger(RouteHelper.name);
  /** 설정 누락 warn 은 일정당 좌표쌍마다 반복되므로 키별로 1회만 남긴다. */
  private readonly warnedKeys = new Set<string>();
  /** 진행 중인 동일 좌표쌍 조회. 캐시가 채워지기 전 동시 요청이 API 를 중복으로 치는 걸 막는다. */
  private readonly inFlight = new Map<string, Promise<EtaResult>>();
  /** 폴백 발생 횟수(`{mode}:{reason}` → count). 지표 노출용 시드 — getFallbackMetrics 로 스냅샷. */
  private readonly fallbackCounts = new Map<string, number>();
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

  /**
   * 캐시 값의 형태를 검증한다. EtaResult 모양이 바뀌면 이전 형식으로 저장된 키가 TTL 동안
   * 남아, 검증 없이 믿으면 undefined 가 호출부의 산술로 흘러들어 NaN 이 된다.
   */
  private async readCache(key: string): Promise<EtaResult | null> {
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return null;
      const { durationSec, distanceM } = parsed as Record<string, unknown>;
      if (!Number.isFinite(durationSec) || !Number.isFinite(distanceM)) return null;
      return { durationSec: durationSec as number, distanceM: distanceM as number };
    } catch {
      return null;
    }
  }

  /**
   * 같은 키의 조회가 이미 진행 중이면 그 Promise 를 함께 기다린다. 캐시는 응답이 온
   * 뒤에야 채워지므로, 이게 없으면 콜드 구간에서 동시 요청이 전부 외부 API 를 친다.
   * 프로세스 내에서만 병합된다 — 여러 인스턴스에 걸친 중복은 캐시 TTL 로만 줄어든다.
   */
  private async coalesce(key: string, load: () => Promise<EtaResult>): Promise<EtaResult> {
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const pending = load().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, pending);
    return pending;
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

  /**
   * 정본 이동 수단으로 경로를 조회한다. 표시용 라벨이 아닌 RouteMode 를 받으므로,
   * 값이 늘면 아래 switch 가 컴파일 타임에 누락을 잡는다.
   */
  async getEta(from: Coordinates, to: Coordinates, mode: RouteMode): Promise<EtaResult> {
    switch (mode) {
      case 'car':
        return this.getDrivingEta(from, to);
      case 'transit':
        return this.getTransitEta(from, to);
      case 'walk':
        return this.getWalkingEta(from, to);
      default: {
        const exhaustive: never = mode;
        throw new Error(`지원하지 않는 이동 수단: ${String(exhaustive)}`);
      }
    }
  }

  /** 도보는 외부 경로 API 없이 거리 기반으로 추정한다(EFFECTIVE_KMH.walk 참고). */
  async getWalkingEta(from: Coordinates, to: Coordinates): Promise<EtaResult> {
    return this.buildLocalEstimate(from, to, 'walk');
  }

  async getDrivingEta(from: Coordinates, to: Coordinates): Promise<EtaResult> {
    const apiKey = this.config.get<string>('KAKAO_REST_API_KEY', '');
    if (!apiKey) {
      return this.fallback(from, to, 'car', 'no_key', 'KAKAO_REST_API_KEY 미설정');
    }

    const cacheKey = this.buildCacheKey(from, to, 'car');
    const cached = await this.readCache(cacheKey);
    if (cached) return cached;

    return this.coalesce(cacheKey, () => this.fetchDrivingEta(from, to, cacheKey, apiKey));
  }

  private async fetchDrivingEta(
    from: Coordinates,
    to: Coordinates,
    cacheKey: string,
    apiKey: string,
  ): Promise<EtaResult> {
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
        return this.fallback(from, to, 'car', 'no_route', '카카오 모빌리티 경로 없음');
      }

      // 길찾기 실패는 HTTP 200 + result_code 로 온다. 던지지 않으므로 직접 본다.
      if (route.result_code === KAKAO_TOO_CLOSE) {
        const zero = { durationSec: 0, distanceM: 0 };
        await this.writeCache(cacheKey, zero, CACHE_TTL_SEC.car);
        return zero;
      }
      if (route.result_code !== 0 || !route.summary) {
        return this.fallback(
          from,
          to,
          'car',
          'api_error',
          `result_code=${route.result_code} msg=${route.result_msg}`,
        );
      }

      // summary.duration=초, summary.distance=미터. 변환 없이 그대로 쓴다.
      const eta = { durationSec: route.summary.duration, distanceM: route.summary.distance };
      await this.writeCache(cacheKey, eta, CACHE_TTL_SEC.car);
      return eta;
    } catch (err) {
      return this.fallback(from, to, 'car', 'network', this.errorDetail(err));
    }
  }

  async getTransitEta(from: Coordinates, to: Coordinates): Promise<EtaResult> {
    const apiKey = this.config.get<string>('ODSAY_API_KEY', '');
    if (!apiKey) {
      return this.fallback(from, to, 'transit', 'no_key', 'ODSAY_API_KEY 미설정');
    }

    // ODsay 는 발급 시 등록한 서비스 URL 을 Referer 로 검증한다. 헤더가 없으면 무조건 ApiKeyAuthFailed.
    const serviceUrl = this.config.get<string>('ODSAY_SERVICE_URL', '');
    if (!serviceUrl) {
      return this.fallback(from, to, 'transit', 'no_service_url', 'ODSAY_SERVICE_URL 미설정');
    }

    const cacheKey = this.buildCacheKey(from, to, 'transit');
    const cached = await this.readCache(cacheKey);
    if (cached) return cached;

    return this.coalesce(cacheKey, () => this.fetchTransitEta(from, to, cacheKey, apiKey, serviceUrl));
  }

  private async fetchTransitEta(
    from: Coordinates,
    to: Coordinates,
    cacheKey: string,
    apiKey: string,
    serviceUrl: string,
  ): Promise<EtaResult> {
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

      // ODsay 는 인증 실패·쿼터 초과·경로 없음도 HTTP 200 + error 배열로 준다. 던지지 않으므로 직접 본다.
      const error = res.data.error?.[0];
      if (error) {
        const reason = classifyOdsayError(error.code, error.message);
        return this.fallback(from, to, 'transit', reason, `code=${error.code} msg=${error.message}`);
      }

      const info = res.data.result?.path?.[0]?.info;
      if (!info) {
        return this.fallback(from, to, 'transit', 'no_route', 'ODsay 경로 없음');
      }

      // totalTime=분, totalDistance=미터. 시간만 초로 바꾼다.
      const eta = { durationSec: info.totalTime * 60, distanceM: info.totalDistance };
      await this.writeCache(cacheKey, eta, CACHE_TTL_SEC.transit);
      return eta;
    } catch (err) {
      return this.fallback(from, to, 'transit', 'network', this.errorDetail(err));
    }
  }

  /**
   * 로컬 추정치로 떨어지는 단일 통로. 이동수단·사유별로 계수해 지표로 남기고, 이상 신호만
   * warn 으로 알린다(정상적인 "경로 없음"류는 debug). 로그는 warnOnce 로 사유별 1회만 —
   * 일정당 좌표쌍마다 반복되면 도배되므로. 계수는 매번 증가해 지표 정확도를 지킨다.
   * walk 는 폴백이 아니라 정식 추정 모델이므로 이 통로를 타지 않는다(getWalkingEta 참고).
   */
  private fallback(
    from: Coordinates,
    to: Coordinates,
    mode: RouteMode,
    reason: RouteFallbackReason,
    detail?: string,
  ): EtaResult {
    const metricKey = `${mode}:${reason}`;
    this.fallbackCounts.set(metricKey, (this.fallbackCounts.get(metricKey) ?? 0) + 1);

    const line = `[route.fallback] mode=${mode} reason=${reason}${detail ? ` ${detail}` : ''} — 로컬 추정치로 대체`;
    if (EXPECTED_FALLBACK.has(reason)) {
      this.logger.debug(line);
    } else {
      this.warnOnce(`fallback:${metricKey}`, line);
    }
    return this.buildLocalEstimate(from, to, mode);
  }

  /**
   * 폴백 발생 횟수 스냅샷(`{mode}:{reason}` → count). 모니터링/지표 노출의 시드다.
   * `transit:quota_or_server` 급증이 곧 ODsay 무료 플랜 쿼터 초과 신호.
   */
  getFallbackMetrics(): Record<string, number> {
    return Object.fromEntries(this.fallbackCounts);
  }

  private errorDetail(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  private buildLocalEstimate(from: Coordinates, to: Coordinates, mode: RouteMode): EtaResult {
    const distanceKm = this.getDistanceKm(from, to);
    return {
      distanceM: Math.round(distanceKm * 1000),
      durationSec: Math.max(
        MIN_DURATION_SEC[mode],
        Math.round((distanceKm / EFFECTIVE_KMH[mode]) * 3600),
      ),
    };
  }

  /**
   * 직선거리(km). 경도 1도의 실제 길이는 위도에 따라 줄어들므로 두 지점의 중간 위도로
   * 보정한다 — 고정 상수를 쓰면 서울 기준에 맞춘 값이 제주에서 5% 어긋난다.
   */
  private getDistanceKm(from: Coordinates, to: Coordinates): number {
    const KM_PER_DEGREE = 111;
    const midLatRad = (((from.lat + to.lat) / 2) * Math.PI) / 180;
    const latDelta = (from.lat - to.lat) * KM_PER_DEGREE;
    const lngDelta = (from.lng - to.lng) * KM_PER_DEGREE * Math.cos(midLatRad);
    return Math.hypot(latDelta, lngDelta);
  }
}
