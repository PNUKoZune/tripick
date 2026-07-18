import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { OPENING_HOURS_FIELD, parseOpeningHours } from './opening-hours.parser';
import { parseSigungu } from './place-seeds';
import type { IngestPlace } from './ingestion.types';

/** ldongCode2 응답 아이템 (법정동 시도 / 시군구 공통). code=lDongRegnCd/lDongSignguCd */
interface LdongCodeItem {
  code: string | number;
  name: string;
}

interface LdongCodeResponse {
  response?: {
    body?: {
      items?: '' | { item?: LdongCodeItem | LdongCodeItem[] };
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

/**
 * detailIntro2 응답 아이템. 필드 구성이 contentTypeId 마다 완전히 다르므로
 * (관광지 usetime / 음식점 opentimefood / …) 키를 열어 두고 OPENING_HOURS_FIELD 로 고른다.
 */
type TourIntroItem = Record<string, unknown>;

interface TourIntroResponse {
  response?: {
    body?: {
      items?: '' | { item?: TourIntroItem | TourIntroItem[] };
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

/** contentTypeId → 한글 유형명 (임베딩 텍스트 강화용). */
const CONTENT_TYPE_NAME: Record<string, string> = {
  '12': '관광지',
  '14': '문화시설',
  '15': '축제공연행사',
  '25': '여행코스',
  '28': '레포츠',
  '38': '쇼핑',
  '39': '음식점',
};

function toArray<T>(item: T | T[] | undefined): T[] {
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

/**
 * 한국관광공사 국문관광정보(KorService2)에서 지역 기반 관광 장소를 수집한다.
 * - ldongCode2: 법정동 시도 코드(lDongRegnCd) 목록
 * - areaBasedList2: 시도별 장소 목록 (contentid, 좌표, 주소, contentTypeId)
 *
 * 지역 필터는 폐기 예정인 areaCode/sigunguCode 대신 **법정동 코드(lDongRegnCd)**를 쓴다
 * (KTO 가 areaCode·sigunguCode·cat1~3 을 lDongRegnCd·lDongSignguCd·lclsSystm1~3 으로 대체).
 * 카테고리는 폐기 대상이 아닌 contentTypeId 로 매핑하고, 시군구는 주소에서 파싱한다.
 * 적재 파이프라인(PlaceIngestionService) 전용. 런타임 조회에는 사용하지 않는다.
 */
@Injectable()
export class TourApiService {
  private readonly logger = new Logger(TourApiService.name);
  private readonly BASE = 'https://apis.data.go.kr/B551011/KorService2';

  constructor(private readonly config: ConfigService) {}

  /** 전국 법정동 시도 목록 (code=lDongRegnCd). lDongRegnCd 미지정 시 시도 반환. */
  async fetchSidoList(): Promise<Array<{ code: string; name: string }>> {
    const apiKey = this.apiKey();
    if (!apiKey) return [];
    const res = await axios.get<LdongCodeResponse>(`${this.BASE}/ldongCode2`, {
      params: {
        serviceKey: apiKey,
        numOfRows: 100,
        pageNo: 1,
        MobileOS: 'ETC',
        MobileApp: 'TriPick',
        _type: 'json',
      },
      timeout: 15000,
    });
    const items = res.data.response?.body?.items;
    return toArray(items && typeof items !== 'string' ? items.item : undefined).map(
      (item) => ({ code: String(item.code), name: item.name }),
    );
  }

  /**
   * 특정 법정동 시도(lDongRegnCd)의 관광 장소를 startPage 부터 최대 maxItems 건 수집한다.
   * numOfRows=maxItems(≤100)로 페이지를 나눠, append 모드가 커서(nextPage)를 이어받아
   * 매 실행 다른 페이지를 읽게 한다. 끝에 도달하면 nextPage=1 로 wrap.
   * @returns places 와 다음 실행이 읽을 페이지(nextPage)
   */
  async fetchByArea(
    lDongRegnCd: string,
    region: string,
    maxItems: number,
    startPage = 1,
  ): Promise<{ places: IngestPlace[]; nextPage: number }> {
    const apiKey = this.apiKey();
    if (!apiKey) return { places: [], nextPage: startPage };

    const batchSize = Math.min(Math.max(1, maxItems), 100); // KTO numOfRows 상한 100
    const pagesToFetch = Math.max(1, Math.ceil(maxItems / batchSize));
    const collected: IngestPlace[] = [];
    // 영업시간은 목록(areaBasedList2)에 없고 detailIntro2 로만 온다. 타입별 필드명이
    // 달라 contentTypeId 를 장소와 함께 들고 있어야 한다.
    const pending: Array<{ place: IngestPlace; contentTypeId: string }> = [];
    let page = startPage;
    let ended = false;

    for (let i = 0; i < pagesToFetch; i += 1) {
      const rows = await this.fetchPage(apiKey, lDongRegnCd, page, batchSize);
      page += 1;
      if (rows.length === 0) {
        ended = true;
        break;
      }
      for (const row of rows) {
        const place = this.toIngestPlace(row, region);
        if (!place) continue;
        collected.push(place);
        pending.push({ place, contentTypeId: String(row.contenttypeid ?? '') });
      }
      if (rows.length < batchSize) {
        ended = true;
        break;
      }
    }

    await this.attachOpeningHours(apiKey, pending);

    return { places: collected, nextPage: ended ? 1 : page };
  }

  /**
   * 수집한 장소에 detailIntro2 영업시간을 채운다. 장소 1건당 호출 1건이 늘어나므로
   * 동시성을 제한하고(KTO 일일 트래픽 상한 보호), 개별 실패는 삼켜 적재를 계속한다
   * — 영업시간은 부가 정보이고, 없으면 소비측이 '제약 없음'으로 처리한다.
   */
  private async attachOpeningHours(
    apiKey: string,
    pending: Array<{ place: IngestPlace; contentTypeId: string }>,
  ): Promise<void> {
    if (!this.openingHoursEnabled()) return;

    // 영업시간 필드가 정의된 타입만 조회한다 (여행코스 등은 애초에 영업시간이 없다).
    const targets = pending.filter(
      ({ place, contentTypeId }) => OPENING_HOURS_FIELD[contentTypeId] && place.tourismApiId,
    );
    if (targets.length === 0) return;

    const concurrency = this.introConcurrency();
    let filled = 0;
    for (let i = 0; i < targets.length; i += concurrency) {
      const chunk = targets.slice(i, i + concurrency);
      const hours = await Promise.all(
        chunk.map(({ place, contentTypeId }) =>
          this.fetchOpeningHours(apiKey, place.tourismApiId!, contentTypeId),
        ),
      );
      chunk.forEach(({ place }, index) => {
        const value = hours[index];
        if (value) {
          place.openingHours = value;
          filled += 1;
        }
      });
    }
    this.logger.log(`detailIntro2 영업시간 ${filled}/${targets.length}건 확보`);
  }

  /** contentId 1건의 영업시간을 'HH:MM-HH:MM' 로 조회한다. 실패·미해석 시 undefined. */
  private async fetchOpeningHours(
    apiKey: string,
    contentId: string,
    contentTypeId: string,
  ): Promise<string | undefined> {
    const field = OPENING_HOURS_FIELD[contentTypeId];
    if (!field) return undefined;

    try {
      const res = await axios.get<TourIntroResponse>(`${this.BASE}/detailIntro2`, {
        params: {
          serviceKey: apiKey,
          numOfRows: 1,
          pageNo: 1,
          MobileOS: 'ETC',
          MobileApp: 'TriPick',
          _type: 'json',
          contentId,
          contentTypeId,
        },
        timeout: 10000,
      });
      const items = res.data.response?.body?.items;
      // 소개정보가 아예 없는 콘텐츠는 items 를 빈 문자열로 준다.
      const item = toArray(items && typeof items !== 'string' ? items.item : undefined)[0];
      if (!item) return undefined;
      const raw = item[field];
      return typeof raw === 'string' ? parseOpeningHours(raw) : undefined;
    } catch (error) {
      this.logger.warn(
        `KTO detailIntro2 실패 (contentId=${contentId}, type=${contentTypeId}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  private async fetchPage(
    apiKey: string,
    lDongRegnCd: string,
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
          lDongRegnCd, // 폐기 예정인 areaCode 대체 (법정동 시도 코드)
        },
        timeout: 10000,
      });
      const items = res.data.response?.body?.items;
      return toArray(items && typeof items !== 'string' ? items.item : undefined);
    } catch (error) {
      this.logger.warn(
        `KTO areaBasedList2 실패 (lDongRegnCd=${lDongRegnCd}, page=${pageNo}): ${error instanceof Error ? error.message : String(error)}`,
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
    const sigungu = parseSigungu(address);
    const categoryDetail = CONTENT_TYPE_NAME[contentTypeId];

    return {
      tourismApiId: String(row.contentid),
      name,
      category,
      ...(categoryDetail ? { categoryDetail } : {}),
      address,
      coordinates: { lat, lng },
      region,
      ...(sigungu ? { sigungu } : {}),
      ...(row.firstimage ? { imageUrl: row.firstimage } : {}),
      source: 'tour',
    };
  }

  private apiKey(): string {
    return this.config.get<string>('KTO_API_KEY', '');
  }

  /** detailIntro2 영업시간 조회 스위치. KTO 일일 트래픽이 빠듯하면 끄고 적재할 수 있다. */
  private openingHoursEnabled(): boolean {
    return this.config.get<string>('KTO_FETCH_OPENING_HOURS', 'true') !== 'false';
  }

  private introConcurrency(): number {
    const value = Number(this.config.get<string | number>('KTO_INTRO_CONCURRENCY', 4));
    return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 16) : 4;
  }
}
