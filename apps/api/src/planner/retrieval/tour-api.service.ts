import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type { IngestPlace } from './ingestion.types';

/** areaCode2 응답 아이템 (시도 / 시군구 공통) */
interface AreaCodeItem {
  code: string | number;
  name: string;
}

interface AreaCodeResponse {
  response?: {
    body?: {
      items?: '' | { item?: AreaCodeItem | AreaCodeItem[] };
    };
  };
}

/** areaBasedList2 응답 아이템 */
interface TourAreaItem {
  contentid: string | number;
  contenttypeid?: string | number;
  title: string;
  addr1?: string;
  addr2?: string;
  mapx?: string | number; // 경도(lng)
  mapy?: string | number; // 위도(lat)
  tel?: string;
  firstimage?: string;
  cat1?: string;
  cat2?: string;
  cat3?: string;
}

interface TourAreaResponse {
  response?: {
    body?: {
      totalCount?: number;
      items?: '' | { item?: TourAreaItem | TourAreaItem[] };
    };
  };
}

/** contentTypeId → 내부 category 매핑 (KorService2 기준) */
const CONTENT_TYPE_CATEGORY: Record<string, string> = {
  '12': 'attraction', // 관광지
  '14': 'attraction', // 문화시설
  '15': 'attraction', // 축제공연행사
  '25': 'attraction', // 여행코스
  '28': 'attraction', // 레포츠
  '32': 'accommodation', // 숙박 — 서비스 범위 밖, 적재에서 제외
  '38': 'attraction', // 쇼핑
  '39': 'restaurant', // 음식점
};

/** 적재에서 제외할 contentTypeId (숙박). 이 서비스는 숙박을 일정 후보로 다루지 않는다. */
const EXCLUDED_CONTENT_TYPES = new Set(['32']);

function toArray<T>(item: T | T[] | undefined): T[] {
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

/**
 * 한국관광공사 국문관광정보(KorService2)에서 지역 기반 관광 장소를 수집한다.
 * - areaCode2: 시도 코드 목록
 * - areaBasedList2: 시도별 장소 목록 (contentid, 좌표, 주소, 카테고리)
 * 적재 파이프라인(PlaceIngestionService) 전용. 런타임 조회에는 사용하지 않는다.
 */
@Injectable()
export class TourApiService {
  private readonly logger = new Logger(TourApiService.name);
  private readonly BASE = 'https://apis.data.go.kr/B551011/KorService2';

  constructor(private readonly config: ConfigService) {}

  /** 전국 시도 코드 목록 (areaCode 미지정 시 시도 반환). */
  async fetchSidoList(): Promise<Array<{ code: string; name: string }>> {
    const apiKey = this.apiKey();
    if (!apiKey) return [];
    const res = await axios.get<AreaCodeResponse>(`${this.BASE}/areaCode2`, {
      params: {
        serviceKey: apiKey,
        numOfRows: 100,
        pageNo: 1,
        MobileOS: 'ETC',
        MobileApp: 'TriPick',
        _type: 'json',
      },
    });
    const items = res.data.response?.body?.items;
    return toArray(items && typeof items !== 'string' ? items.item : undefined).map(
      (item) => ({ code: String(item.code), name: item.name }),
    );
  }

  /**
   * 특정 시도(areaCode)의 관광 장소를 최대 maxItems 건 수집한다.
   * region 라벨(시도명)을 각 장소에 부여한다.
   */
  async fetchByArea(
    areaCode: string,
    region: string,
    maxItems: number,
  ): Promise<IngestPlace[]> {
    const apiKey = this.apiKey();
    if (!apiKey) return [];

    const pageSize = 100;
    const collected: IngestPlace[] = [];
    const totalPages = Math.ceil(maxItems / pageSize);

    for (let page = 1; page <= totalPages; page += 1) {
      const rows = await this.fetchPage(apiKey, areaCode, page, pageSize);
      if (rows.length === 0) break;
      for (const row of rows) {
        const place = this.toIngestPlace(row, region);
        if (place) collected.push(place);
        if (collected.length >= maxItems) return collected;
      }
      if (rows.length < pageSize) break;
    }

    return collected;
  }

  private async fetchPage(
    apiKey: string,
    areaCode: string,
    pageNo: number,
    numOfRows: number,
  ): Promise<TourAreaItem[]> {
    try {
      const res = await axios.get<TourAreaResponse>(`${this.BASE}/areaBasedList2`, {
        params: {
          serviceKey: apiKey,
          numOfRows,
          pageNo,
          MobileOS: 'ETC',
          MobileApp: 'TriPick',
          _type: 'json',
          arrange: 'O', // 대표이미지 있는 순 정렬
          areaCode,
        },
        timeout: 10000,
      });
      const items = res.data.response?.body?.items;
      return toArray(items && typeof items !== 'string' ? items.item : undefined);
    } catch (error) {
      this.logger.warn(
        `KTO areaBasedList2 실패 (areaCode=${areaCode}, page=${pageNo}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  private toIngestPlace(row: TourAreaItem, region: string): IngestPlace | null {
    const lat = Number(row.mapy);
    const lng = Number(row.mapx);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
      return null;
    }
    const name = String(row.title ?? '').trim();
    if (!name) return null;

    const contentTypeId = String(row.contenttypeid ?? '');
    if (EXCLUDED_CONTENT_TYPES.has(contentTypeId)) return null; // 숙박 제외
    const category = CONTENT_TYPE_CATEGORY[contentTypeId] ?? 'attraction';
    const address = [row.addr1, row.addr2].filter(Boolean).join(' ').trim();

    return {
      tourismApiId: String(row.contentid),
      name,
      category,
      address,
      coordinates: { lat, lng },
      region,
      ...(row.firstimage ? { imageUrl: row.firstimage } : {}),
      source: 'tour',
    };
  }

  private apiKey(): string {
    return this.config.get<string>('KTO_API_KEY', '');
  }
}
