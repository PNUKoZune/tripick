import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { OPENING_HOURS_FIELD, parseOpeningHours } from './opening-hours.parser';
import { isTravelCourseArticle } from './place-name-quality';
import { parseSigungu } from './place-seeds';
import type { IngestPlace } from './ingestion.types';
import type { Coordinates } from '@tripick/types';

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

/** searchKeyword2 응답 아이템 (이름 검색). 좌표 대조 후 contentid/contenttypeid 를 detailIntro2 로 넘긴다. */
interface TourKeywordItem {
  contentid: string | number;
  contenttypeid?: string | number;
  title: string;
  mapx?: string | number; // 경도(lng)
  mapy?: string | number; // 위도(lat)
}

interface TourKeywordResponse {
  response?: {
    body?: {
      items?: '' | { item?: TourKeywordItem | TourKeywordItem[] };
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

/** 여행코스. 실제 코스명과 큐레이션 기사가 섞여 오므로 이름 모양으로 한 번 더 가른다. */
export const TRAVEL_COURSE_CONTENT_TYPE = '25';

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

/** KTO 일일 호출량 초과를 정상 '데이터 없음'과 구분하기 위한 신호. */
export class KtoQuotaExceededError extends Error {
  constructor(path: string) {
    super(`KTO 일일 호출량 초과 (${path})`);
    this.name = 'KtoQuotaExceededError';
  }
}

/**
 * KTO 응답이 일일 호출량 초과인지 판정한다. data.go.kr 은 초과를 두 형태로 준다:
 * 1) 서비스 응답 JSON header.resultCode=22
 * 2) 게이트웨이 XML 문자열 (_type=json 이어도 XML 로 옴) — returnReasonCode 22 /
 *    LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR
 * 둘 다 axios 가 던지지 않으므로(HTTP 200) 본문을 직접 봐야 한다.
 */
export function detectKtoQuota(data: unknown): boolean {
  if (typeof data === 'string') {
    return (
      data.includes('LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS') ||
      /<returnReasonCode>\s*22\s*<\/returnReasonCode>/.test(data)
    );
  }
  if (data && typeof data === 'object') {
    const header = (data as { response?: { header?: { resultCode?: unknown; resultMsg?: unknown } } })
      .response?.header;
    if (!header) return false;
    const code = String(header.resultCode ?? '');
    const msg = String(header.resultMsg ?? '');
    return code === '22' || msg.includes('LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS');
  }
  return false;
}

/**
 * 1회 적재 실행의 KTO 호출 예산. 일일 한도(1000)를 넘지 않도록 실행당 호출 수를 캡한다.
 * 소진되거나 초과 응답을 만나면(markExhausted) 이후 호출을 막아 헛호출을 끊는다.
 * 런타임 조회(수동 추가)는 저볼륨이라 예산 없이(감지만) 동작한다.
 */
export class KtoCallBudget {
  private remaining: number;
  private exhausted = false;

  constructor(limit: number) {
    this.remaining = Math.max(0, Math.floor(limit));
  }

  get isExhausted(): boolean {
    return this.exhausted || this.remaining <= 0;
  }

  /** 호출 1건을 예산에서 차감한다. 남으면 true, 소진이면 false(호출 금지). */
  consume(): boolean {
    if (this.isExhausted) return false;
    this.remaining -= 1;
    return true;
  }

  /** 초과 응답을 만났을 때 남은 예산과 무관하게 즉시 소진 처리한다. */
  markExhausted(): void {
    this.exhausted = true;
  }
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
  /**
   * 이름 검색 후보를 같은 장소로 인정할 좌표 반경(m). KTO 좌표와 카카오/사용자 좌표는
   * 지오코딩 출처가 달라 같은 장소도 수십~수백 m 어긋나므로, 적재 dedupe(≈100m)보다
   * 여유 있게 잡되 인접 타지점(보통 수백 m~km)은 배제되도록 250m 로 둔다.
   */
  private static readonly MATCH_RADIUS_M = 250;

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
    budget?: KtoCallBudget,
  ): Promise<{ places: IngestPlace[]; nextPage: number; quotaExceeded: boolean }> {
    const apiKey = this.apiKey();
    if (!apiKey) return { places: [], nextPage: startPage, quotaExceeded: false };

    const batchSize = Math.min(Math.max(1, maxItems), 100); // KTO numOfRows 상한 100
    const pagesToFetch = Math.max(1, Math.ceil(maxItems / batchSize));
    const collected: IngestPlace[] = [];
    // 영업시간은 목록(areaBasedList2)에 없고 detailIntro2 로만 온다. 타입별 필드명이
    // 달라 contentTypeId 를 장소와 함께 들고 있어야 한다.
    const pending: Array<{ place: IngestPlace; contentTypeId: string }> = [];
    let page = startPage;
    let ended = false;
    let quotaExceeded = false;

    try {
      for (let i = 0; i < pagesToFetch; i += 1) {
        const rows = await this.fetchPage(apiKey, lDongRegnCd, page, batchSize, budget);
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

      quotaExceeded = await this.attachOpeningHours(apiKey, pending, budget);
    } catch (error) {
      // 호출량 초과는 남은 페이지·영업시간 조회를 멈추고 지금까지 모은 것만 반환한다.
      if (error instanceof KtoQuotaExceededError) {
        this.logger.warn(`[${region}] KTO 호출량 초과 — 이 지역 수집을 중단합니다.`);
        quotaExceeded = true;
      } else {
        throw error;
      }
    }

    return { places: collected, nextPage: ended ? 1 : page, quotaExceeded };
  }

  /**
   * 수집한 장소에 detailIntro2 영업시간을 채운다. 장소 1건당 호출 1건이 늘어나므로
   * 동시성을 제한하고(KTO 일일 트래픽 상한 보호), 개별 실패는 삼켜 적재를 계속한다
   * — 영업시간은 부가 정보이고, 없으면 소비측이 '제약 없음'으로 처리한다.
   */
  private async attachOpeningHours(
    apiKey: string,
    pending: Array<{ place: IngestPlace; contentTypeId: string }>,
    budget?: KtoCallBudget,
  ): Promise<boolean> {
    if (!this.openingHoursEnabled()) return false;

    // 영업시간 필드가 정의된 타입만 조회한다 (여행코스 등은 애초에 영업시간이 없다).
    const targets = pending.filter(
      ({ place, contentTypeId }) => OPENING_HOURS_FIELD[contentTypeId] && place.tourismApiId,
    );
    if (targets.length === 0) return false;

    const concurrency = this.introConcurrency();
    let filled = 0;
    try {
      for (let i = 0; i < targets.length; i += concurrency) {
        // 예산이 이미 소진됐으면 다음 청크를 아예 시작하지 않는다.
        if (budget?.isExhausted) throw new KtoQuotaExceededError('detailIntro2');
        const chunk = targets.slice(i, i + concurrency);
        const hours = await Promise.all(
          chunk.map(({ place, contentTypeId }) =>
            this.fetchOpeningHours(apiKey, place.tourismApiId!, contentTypeId, budget),
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
    } catch (error) {
      if (error instanceof KtoQuotaExceededError) {
        this.logger.warn(
          `detailIntro2 호출량 초과 — ${filled}/${targets.length}건까지만 확보하고 중단합니다.`,
        );
        return true;
      }
      throw error;
    }
    this.logger.log(`detailIntro2 영업시간 ${filled}/${targets.length}건 확보`);
    return false;
  }

  /**
   * contentId 1건의 영업시간을 'HH:MM-HH:MM' 로 조회한다. 실패·미해석 시 undefined.
   * budget 이 주어지면 호출 전 예산을 차감하고, 호출량 초과 응답을 만나면
   * {@link KtoQuotaExceededError} 를 던져(개별 실패와 구분) 상위에서 배치를 끊게 한다.
   */
  private async fetchOpeningHours(
    apiKey: string,
    contentId: string,
    contentTypeId: string,
    budget?: KtoCallBudget,
  ): Promise<string | undefined> {
    const field = OPENING_HOURS_FIELD[contentTypeId];
    if (!field) return undefined;
    if (budget && !budget.consume()) throw new KtoQuotaExceededError('detailIntro2');

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
      if (detectKtoQuota(res.data)) {
        budget?.markExhausted();
        throw new KtoQuotaExceededError('detailIntro2');
      }
      const items = res.data.response?.body?.items;
      // 소개정보가 아예 없는 콘텐츠는 items 를 빈 문자열로 준다.
      const item = toArray(items && typeof items !== 'string' ? items.item : undefined)[0];
      if (!item) return undefined;
      const raw = item[field];
      return typeof raw === 'string' ? parseOpeningHours(raw) : undefined;
    } catch (error) {
      if (error instanceof KtoQuotaExceededError) throw error; // 초과는 상위로 전파해 배치 중단
      this.logger.warn(
        `KTO detailIntro2 실패 (contentId=${contentId}, type=${contentTypeId}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  /**
   * 이름+좌표로 KTO 장소를 찾아 영업시간을 'HH:MM-HH:MM' 로 조회한다.
   * 적재 카탈로그(place_embeddings)에 없는 수동 추가 장소를 런타임에 보강하기 위한 경로.
   *
   * searchKeyword2(이름) 결과 중 좌표가 coords 와 {@link MATCH_RADIUS_M} 이내인 가장 가까운
   * 후보만 채택한다 — 이름 검색은 동명·타지점을 함께 주므로(예: '불국사'→경주/서울)
   * 좌표 대조 없이는 오매칭 위험이 크다. 반경 밖이면 매칭 실패로 보고 undefined.
   * KTO 미등록 장소(카페·프랜차이즈 다수)는 검색 0건 → undefined.
   */
  async resolveOpeningHours(name: string, coords: Coordinates): Promise<string | undefined> {
    if (!this.openingHoursEnabled()) return undefined;
    const apiKey = this.apiKey();
    const keyword = name.trim();
    if (!apiKey || !keyword) return undefined;

    const match = await this.searchKeywordNearest(apiKey, keyword, coords);
    if (!match) return undefined;
    // 영업시간 필드가 정의된 타입만 detailIntro2 를 부른다 (여행코스·숙박 등은 제외).
    if (!OPENING_HOURS_FIELD[match.contentTypeId]) return undefined;
    try {
      // 런타임 경로는 예산 없이(저볼륨) 동작하되, 호출량 초과는 조용히 영업시간 없이 넘긴다.
      return await this.fetchOpeningHours(apiKey, match.contentId, match.contentTypeId);
    } catch (error) {
      if (error instanceof KtoQuotaExceededError) {
        this.logger.warn('KTO 호출량 초과 — 수동 추가 장소 영업시간 조회를 건너뜁니다.');
        return undefined;
      }
      throw error;
    }
  }

  /**
   * searchKeyword2 결과에서 coords 에 가장 가까운(반경 내) 후보의 contentId·contentTypeId 를 반환.
   * 반경 밖이거나 결과가 없으면 null.
   */
  private async searchKeywordNearest(
    apiKey: string,
    keyword: string,
    coords: Coordinates,
  ): Promise<{ contentId: string; contentTypeId: string } | null> {
    try {
      const res = await axios.get<TourKeywordResponse>(`${this.BASE}/searchKeyword2`, {
        params: {
          serviceKey: apiKey,
          numOfRows: 20,
          pageNo: 1,
          MobileOS: 'ETC',
          MobileApp: 'TriPick',
          _type: 'json',
          arrange: 'A',
          keyword,
        },
        timeout: 10000,
      });
      if (detectKtoQuota(res.data)) {
        this.logger.warn(`KTO searchKeyword2 호출량 초과 (keyword=${keyword})`);
        return null;
      }
      const items = res.data.response?.body?.items;
      const rows = toArray(items && typeof items !== 'string' ? items.item : undefined);

      let best: { contentId: string; contentTypeId: string; distanceM: number } | null = null;
      for (const row of rows) {
        const lat = Number(row.mapy);
        const lng = Number(row.mapx);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const distanceM = this.distanceMeters(coords, { lat, lng });
        if (distanceM > TourApiService.MATCH_RADIUS_M) continue;
        if (!best || distanceM < best.distanceM) {
          best = {
            contentId: String(row.contentid),
            contentTypeId: String(row.contenttypeid ?? ''),
            distanceM,
          };
        }
      }
      return best ? { contentId: best.contentId, contentTypeId: best.contentTypeId } : null;
    } catch (error) {
      this.logger.warn(
        `KTO searchKeyword2 실패 (keyword=${keyword}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /** 두 좌표의 직선거리(m). 경도는 위도에 따라 줄어들므로 중간 위도로 보정한다. */
  private distanceMeters(a: Coordinates, b: Coordinates): number {
    const KM_PER_DEGREE = 111;
    const midLatRad = (((a.lat + b.lat) / 2) * Math.PI) / 180;
    const latDelta = (a.lat - b.lat) * KM_PER_DEGREE;
    const lngDelta = (a.lng - b.lng) * KM_PER_DEGREE * Math.cos(midLatRad);
    return Math.hypot(latDelta, lngDelta) * 1000;
  }

  /**
   * 한 시도의 특정 contentTypeId 에 속하는 contentId 전체를 모은다 (정리 스크립트용).
   *
   * 왜 필요한가 — 적재된 행은 contentTypeId 를 저장하지 않으므로, 이미 들어온 여행코스 기사를
   * 이름 모양만으로 골라내면 '경산 임당동과 조영동 고분군' 같은 실제 명소가 함께 죽는다.
   * KTO 에 "이 시도의 여행코스 목록"을 되물어 확정 집합을 만든 뒤에 이름 규칙을 적용한다.
   */
  async fetchContentIds(
    lDongRegnCd: string,
    contentTypeId: string,
    maxPages = 20,
  ): Promise<string[]> {
    const apiKey = this.apiKey();
    if (!apiKey) return [];

    const numOfRows = 100; // KTO 상한
    const ids: string[] = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const rows = await this.fetchPage(apiKey, lDongRegnCd, page, numOfRows, undefined, contentTypeId);
      for (const row of rows) {
        const id = String(row.contentid ?? '').trim();
        if (id) ids.push(id);
      }
      if (rows.length < numOfRows) break;
    }
    return ids;
  }

  private async fetchPage(
    apiKey: string,
    lDongRegnCd: string,
    pageNo: number,
    numOfRows: number,
    budget?: KtoCallBudget,
    contentTypeId?: string,
  ): Promise<TourAreaItem[]> {
    if (budget && !budget.consume()) throw new KtoQuotaExceededError('areaBasedList2');
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
          ...(contentTypeId ? { contentTypeId } : {}),
        },
        timeout: 10000,
      });
      if (detectKtoQuota(res.data)) {
        budget?.markExhausted();
        throw new KtoQuotaExceededError('areaBasedList2');
      }
      const items = res.data.response?.body?.items;
      return toArray(items && typeof items !== 'string' ? items.item : undefined);
    } catch (error) {
      if (error instanceof KtoQuotaExceededError) throw error; // 초과는 상위로 전파해 수집 중단
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

    // 여행코스(25)에는 실제 코스명('남파랑길 25코스')과 큐레이션 기사('가정의 달, 싱글을 위한
    // 혼자 먹는 밥상 코스')가 섞여 온다. 기사는 방문할 지점이 아니므로 적재하지 않는다.
    if (contentTypeId === TRAVEL_COURSE_CONTENT_TYPE && isTravelCourseArticle(name, address)) {
      return null;
    }
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

  /**
   * 1회 적재 실행의 KTO 호출 예산을 만든다. KTO 일일 한도(API별 1000)를 넘지 않도록
   * 기본 900 으로 두고, 초과 시 적재는 --append 로 며칠에 나눠 이어받는다.
   */
  createCallBudget(): KtoCallBudget {
    const value = Number(this.config.get<string | number>('KTO_DAILY_CALL_BUDGET', 900));
    const limit = Number.isFinite(value) && value > 0 ? Math.floor(value) : 900;
    return new KtoCallBudget(limit);
  }
}
