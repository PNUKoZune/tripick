import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type { Coordinates } from '@tripick/types';

interface EtaResult {
  durationSec: number;
  distanceM: number;
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
 * OTP2(OpenTripPlanner) GraphQL 로 두 좌표 간 경로 ETA 를 조회한다.
 * 자동차(CAR)·대중교통(TRANSIT+WALK) 를 동일 그래프에서 처리하며,
 * OTP 미가동·경로 없음·오류 시에는 직선거리 기반 로컬 추정으로 폴백한다.
 */
@Injectable()
export class RouteHelper {
  private readonly logger = new Logger(RouteHelper.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * @param departAt 계획상 출발 시각. 대중교통은 시간표 기반이라 이 값이 없으면
   *   "현재 시각"으로 계산돼 밤/새벽엔 배차가 없어 왜곡되므로, 호출부에서 넘겨야 정확하다.
   */
  async getDrivingEta(from: Coordinates, to: Coordinates, departAt?: Date): Promise<EtaResult> {
    return this.queryOtp(from, to, '[{ mode: CAR }]', 28, departAt);
  }

  async getTransitEta(from: Coordinates, to: Coordinates, departAt?: Date): Promise<EtaResult> {
    return this.queryOtp(from, to, '[{ mode: TRANSIT }, { mode: WALK }]', 20, departAt);
  }

  /** OTP GraphQL plan 질의. 실패하면 fallbackKmPerHour 로 로컬 추정. */
  private async queryOtp(
    from: Coordinates,
    to: Coordinates,
    modes: string,
    fallbackKmPerHour: number,
    departAt?: Date,
  ): Promise<EtaResult> {
    const baseUrl = this.config.get<string>('OTP_BASE_URL', 'http://localhost:8090');
    if (!baseUrl) {
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
        { headers: { 'Content-Type': 'application/json' }, timeout: 5000 },
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
      };
    } catch (err) {
      this.logger.error('OTP ETA 조회 실패:', err);
      return this.buildLocalEstimate(from, to, fallbackKmPerHour);
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
