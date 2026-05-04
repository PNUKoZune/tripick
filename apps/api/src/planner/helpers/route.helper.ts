import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type { Coordinates } from '@tripick/types';

interface EtaResult {
  durationSec: number;
  distanceM: number;
}

/**
 * TMAP API (자동차·도보), ODsay API (대중교통) 경로 ETA Helper
 */
@Injectable()
export class RouteHelper {
  private readonly logger = new Logger(RouteHelper.name);

  constructor(private readonly config: ConfigService) {}

  /** 자동차 ETA (TMAP) */
  async getDrivingEta(from: Coordinates, to: Coordinates): Promise<EtaResult> {
    const apiKey = this.config.get<string>('TMAP_API_KEY', '');
    if (!apiKey) {
      this.logger.warn('TMAP_API_KEY not configured');
      return { durationSec: 0, distanceM: 0 };
    }

    try {
      const res = await axios.post<{
        features: Array<{ properties: { totalTime: number; totalDistance: number } }>;
      }>(
        'https://apis.openapi.sk.com/tmap/routes',
        {
          startX: from.lng,
          startY: from.lat,
          endX: to.lng,
          endY: to.lat,
          reqCoordType: 'WGS84GEO',
          resCoordType: 'WGS84GEO',
          searchOption: 0,
        },
        { headers: { appKey: apiKey } },
      );

      const props = res.data.features[0]?.properties;
      return {
        durationSec: props?.totalTime ?? 0,
        distanceM: props?.totalDistance ?? 0,
      };
    } catch (err) {
      this.logger.error('TMAP ETA 조회 실패:', err);
      return { durationSec: 0, distanceM: 0 };
    }
  }

  /** 대중교통 ETA (ODsay) */
  async getTransitEta(from: Coordinates, to: Coordinates): Promise<EtaResult> {
    const apiKey = this.config.get<string>('ODSAY_API_KEY', '');
    if (!apiKey) {
      this.logger.warn('ODSAY_API_KEY not configured');
      return { durationSec: 0, distanceM: 0 };
    }

    try {
      const res = await axios.get<{
        result: { path: Array<{ info: { totalTime: number; totalDistance: number } }> };
      }>('https://api.odsay.com/v1/api/searchPubTransPathT', {
        params: {
          apiKey,
          SX: from.lng,
          SY: from.lat,
          EX: to.lng,
          EY: to.lat,
        },
      });

      const info = res.data.result.path[0]?.info;
      return {
        durationSec: (info?.totalTime ?? 0) * 60,
        distanceM: (info?.totalDistance ?? 0) * 1000,
      };
    } catch (err) {
      this.logger.error('ODsay ETA 조회 실패:', err);
      return { durationSec: 0, distanceM: 0 };
    }
  }
}
