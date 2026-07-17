import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type { Coordinates } from '@tripick/types';

interface EtaResult {
  durationSec: number;
  distanceM: number;
}

const REQUEST_TIMEOUT_MS = 10_000;

/** 카카오 모빌리티 result_code: 출발지와 도착지가 5m 이내. 경로가 아니라 "이동 없음"이 정답이다. */
const KAKAO_TOO_CLOSE = 104;

@Injectable()
export class RouteHelper {
  private readonly logger = new Logger(RouteHelper.name);
  /** 설정 누락 warn 은 일정당 좌표쌍마다 반복되므로 키별로 1회만 남긴다. */
  private readonly warnedKeys = new Set<string>();

  constructor(private readonly config: ConfigService) {}

  private warnOnce(key: string, message: string): void {
    if (this.warnedKeys.has(key)) return;
    this.warnedKeys.add(key);
    this.logger.warn(message);
  }

  async getDrivingEta(from: Coordinates, to: Coordinates): Promise<EtaResult> {
    const apiKey = this.config.get<string>('KAKAO_REST_API_KEY', '');
    if (!apiKey) {
      this.warnOnce('KAKAO_REST_API_KEY', 'KAKAO_REST_API_KEY 미설정 — 자동차 ETA 를 로컬 추정치로 대체합니다.');
      return this.buildLocalEstimate(from, to, 28);
    }

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
        return { durationSec: 0, distanceM: 0 };
      }
      if (route.result_code !== 0 || !route.summary) {
        this.logger.error(
          `카카오 모빌리티 길찾기 실패 (${route.result_code}: ${route.result_msg}) — 로컬 추정치로 대체합니다.`,
        );
        return this.buildLocalEstimate(from, to, 28);
      }

      // summary.duration=초, summary.distance=미터. 변환 없이 그대로 쓴다.
      return { durationSec: route.summary.duration, distanceM: route.summary.distance };
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
      return { durationSec: info.totalTime * 60, distanceM: info.totalDistance };
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
