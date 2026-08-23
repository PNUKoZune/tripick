import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { OPENING_HOURS_FIELD, parseOpeningHours } from './opening-hours.parser';
import { isRetailBranchOutlet, isTravelCourseArticle } from './place-name-quality';
import { isPlausibleKoreanCoordinate } from './place-eligibility';
import { SAME_PLACE_RADIUS_M } from './near-duplicate';
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
  /** 분류체계 대분류 (음식은 'FD'). cat1~3 을 대체하는 신 체계 */
  lclsSystm1?: string;
  /** 분류체계 중분류 (FD01 한식 / FD02 외국식 / FD03 간이음식 / FD04 주점 / FD05 카페·찻집) */
  lclsSystm2?: string;
  /** 분류체계 소분류 (FD030100 제과 등) */
  lclsSystm3?: string;
}

interface TourAreaResponse {
  response?: {
    body?: {
      totalCount?: number;
      items?: '' | { item?: TourAreaItem | TourAreaItem[] };
    };
  };
}

/** searchFestival2 응답 아이템. 목록 API 중 유일하게 행사 기간을 준다. */
interface TourFestivalItem {
  contentid: string | number;
  eventstartdate?: string | number;
  eventenddate?: string | number;
}

interface TourFestivalResponse {
  response?: {
    body?: {
      items?: '' | { item?: TourFestivalItem | TourFestivalItem[] };
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

/**
 * 쇼핑. 전통시장(여행지)과 체인 매장·건물 입점 점포(여행지 아님)가 섞여 오므로
 * 여행코스와 같은 방식으로 이름·주소 모양을 한 번 더 본다.
 */
export const SHOPPING_CONTENT_TYPE = '38';

/**
 * 축제공연행사. **장소가 아니라 기간이 있는 이벤트**라 행사 기간을 함께 싣는다.
 * 기간이 없으면 이미 끝난 행사가 상시 장소처럼 후보에 남는다.
 */
export const FESTIVAL_CONTENT_TYPE = '15';

/**
 * searchFestival2 의 `eventStartDate` 하한. **시작일 기준 필터**라 값이 오늘에 가까우면
 * "오래전 시작해 아직 진행 중인 장기 행사"가 통째로 빠진다. 과거로 충분히 밀어 전량을 받는다
 * (부산 실측: 19000101·20200101 둘 다 71건으로 동일 — 하한을 낮춰도 손해가 없다).
 */
const FESTIVAL_SEARCH_FROM = '19000101';

/** 시도당 축제 페이지 상한. 실측 최다가 서울 191건(2페이지)이라 여유가 크다. */
const FESTIVAL_MAX_PAGES = 10;

/** 시도당 음식 분류 페이지 상한. 전국 카페가 3,075건이라 한 시도가 10페이지(1,000건)를 넘지 않는다. */
const FOOD_CLASS_MAX_PAGES = 10;

/** KTO 날짜(YYYYMMDD) → 'YYYY-MM-DD'. 형식이 어긋나면 undefined 로 두어 상시 장소로 남긴다. */
function toIsoDate(value: string | number | undefined): string | undefined {
  const raw = String(value ?? '').trim();
  if (!/^\d{8}$/.test(raw)) return undefined;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

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

/** 음식점 contentTypeId. 이것만 분류체계 중분류로 한 번 더 가른다. */
export const FOOD_CONTENT_TYPE = '39';

/** areaBasedList2 의 음식 분류 필터. 둘 다 주면 KTO 가 AND 로 좁힌다. */
export interface FoodClassFilter {
  lclsSystm2?: string;
  lclsSystm3?: string;
}

/**
 * 음식(FD) 중분류 → 내부 category. contentTypeId 39 가 카페·찻집까지 한 덩어리라
 * KTO 에서 온 카페가 전부 restaurant 로 적재됐다 — 카페 후보는 카카오 소스에만 있었고,
 * 일정의 카페 자리가 만성적으로 비는 원인이었다(전국 13,498건 중 FD05 가 3,075건).
 *
 * 소분류(lclsSystm3)가 아니라 **중분류**로 가르는 이유 — 소분류는 한식만 관광식당·모범음식점
 * 둘뿐이라 끼니/휴식 구분에 아무 정보도 더하지 않고, 표를 KTO 개편마다 따라다녀야 한다.
 * 예외는 제과 하나뿐이라 그것만 소분류로 집는다.
 */
const FOOD_CLASS_CATEGORY: Record<string, string> = {
  FD01: 'restaurant', // 한식
  FD02: 'restaurant', // 외국식
  FD03: 'restaurant', // 간이음식 (제과만 아래에서 예외)
  FD04: 'restaurant', // 주점 — 전국 7건뿐이라 따로 다루지 않는다
  FD05: 'cafe', // 카페/찻집
};

/**
 * 간이음식(FD03) 중 제과. 앉아 쉬는 자리라 끼니보다 오후 휴식 슬롯에 맞다 —
 * 카페로 두면 최악이 "빵집에서 쉼", 음식점으로 두면 최악이 "빵집에서 저녁". 전자가 낫다.
 */
const BAKERY_FOOD_CLASS = 'FD030100';

/** 카페로 분류된 KTO 음식 행의 categoryDetail. 임베딩 텍스트가 '음식점'이라고 말하던 걸 바로잡는다. */
const FOOD_CLASS_NAME: Record<string, string> = {
  FD05: '카페',
  [BAKERY_FOOD_CLASS]: '제과',
};

/**
 * KTO 음식 행의 category·categoryDetail 을 분류체계로 정한다.
 *
 * 분류체계가 비어 있으면 기존 동작(restaurant/'음식점')으로 떨어진다. 구 `cat3` 폴백은 두지
 * 않았다 — 표본 600건 전부 lclsSystm2 가 채워져 있어(빈값 0) 쓰이지 않을 경로다.
 *
 * restaurant 로 남는 행의 categoryDetail 을 '음식점' 그대로 두는 것도 의도다. 라벨이 임베딩
 * 텍스트에 들어가므로 바꾸면 해시가 달라져 멀쩡한 12,000여 행이 통째로 재임베딩된다.
 */
export function classifyTourFood(item: {
  lclsSystm2?: string;
  lclsSystm3?: string;
}): { category: string; categoryDetail: string } {
  const mid = String(item.lclsSystm2 ?? '').trim().toUpperCase();
  const leaf = String(item.lclsSystm3 ?? '').trim().toUpperCase();
  if (leaf === BAKERY_FOOD_CLASS) {
    return { category: 'cafe', categoryDetail: FOOD_CLASS_NAME[BAKERY_FOOD_CLASS]! };
  }
  const category = FOOD_CLASS_CATEGORY[mid] ?? 'restaurant';
  return { category, categoryDetail: FOOD_CLASS_NAME[mid] ?? CONTENT_TYPE_NAME[FOOD_CONTENT_TYPE]! };
}

/**
 * 카페로 재분류해야 할 음식 분류. 이미 적재된 행을 고치는 backfill CLI 가 이 필터로
 * "카페인 contentId" 만 KTO 에 물어본다 — 전체를 다시 읽으면 일일 예산(900콜)으로는 며칠이 걸린다.
 */
export const CAFE_FOOD_CLASSES: ReadonlyArray<FoodClassFilter & { categoryDetail: string }> = [
  { lclsSystm2: 'FD05', categoryDetail: FOOD_CLASS_NAME.FD05! },
  { lclsSystm3: BAKERY_FOOD_CLASS, categoryDetail: FOOD_CLASS_NAME[BAKERY_FOOD_CLASS]! },
];

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
/**
 * HTTP 429 = 호출량 초과. **본문 검사(`detectKtoQuota`)로는 안 잡힌다** — 그건 KTO 가 200 에
 * 실어 보내는 초과 메시지를 보는 것이고, 429 는 axios 가 던져서 일반 catch 로 빠진다.
 *
 * 그래서 실측에서 이렇게 됐다: 전량 적재를 하루에 세 번 돌린 뒤 백필을 실행했더니 서울 8페이지째부터
 * 전부 429 였는데, 지역마다 실패 경고만 찍고 16개 시도를 끝까지 돌고 **"적재 완료: 신규 0 / 갱신 0"**
 * 으로 끝났다. "할 일이 없었다"와 "전부 실패했다"가 같은 보고로 나온 것이다.
 */
function isRateLimited(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { response?: { status?: number } }).response?.status === 429
  );
}

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
   * 특정 법정동 시도(lDongRegnCd)의 관광 장소를 startOffset 행부터 최대 maxItems 건 수집한다.
   * numOfRows=maxItems(≤100)로 페이지를 나눠, append 모드가 커서(nextOffset)를 이어받아
   * 매 실행 다른 구간을 읽게 한다. 끝에 도달하면 nextOffset=0 으로 wrap.
   *
   * 커서를 **행 오프셋**으로 주고받는 이유 — 페이지 번호는 그 실행의 배치 크기에 묶여 있어서
   * `--max` 를 바꾸면 같은 커서가 다른 구간을 뜻한다. KTO 는 pageNo·numOfRows 만 받으므로
   * 오프셋을 페이지 경계로 **내림** 정렬해 쓴다 — 내림이면 이미 읽은 구간을 다시 확인할 뿐이고
   * (텍스트 해시가 같아 unchanged), 올림이면 그 사이 행을 영구히 건너뛴다.
   *
   * @returns places 와 다음 실행이 읽을 행 오프셋(nextOffset)
   */
  async fetchByArea(
    lDongRegnCd: string,
    region: string,
    maxItems: number,
    startOffset = 0,
    budget?: KtoCallBudget,
  ): Promise<{ places: IngestPlace[]; nextOffset: number; quotaExceeded: boolean }> {
    const apiKey = this.apiKey();
    if (!apiKey) return { places: [], nextOffset: startOffset, quotaExceeded: false };

    const batchSize = Math.min(Math.max(1, maxItems), 100); // KTO numOfRows 상한 100
    const pagesToFetch = Math.max(1, Math.ceil(maxItems / batchSize));
    const collected: IngestPlace[] = [];
    // 영업시간은 목록(areaBasedList2)에 없고 detailIntro2 로만 온다. 타입별 필드명이
    // 달라 contentTypeId 를 장소와 함께 들고 있어야 한다.
    const pending: Array<{ place: IngestPlace; contentTypeId: string }> = [];
    let page = Math.floor(Math.max(0, startOffset) / batchSize) + 1;
    // 읽은 행 수. 페이지 경계로 내림 정렬한 시작점에서 출발한다.
    let consumed = (page - 1) * batchSize;
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
        consumed += rows.length;
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

      await this.attachEventPeriods(apiKey, lDongRegnCd, region, pending, budget);
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

    return { places: collected, nextOffset: ended ? 0 : consumed, quotaExceeded };
  }

  /**
   * 수집한 축제공연행사(15) 행에 행사 기간을 채운다.
   *
   * 목록 API(areaBasedList2)는 `eventstartdate`/`eventenddate` 를 **주지 않는다** — 응답 필드를
   * 열어 확인했다. detailIntro2 로 받으면 건당 1콜이라 전국 1,200여 건에 그만큼이 들지만,
   * `searchFestival2` 는 같은 값을 **목록으로** 준다(시도당 1~2콜). 부산 71건 = areaBasedList2 의
   * 축제 총수와 정확히 일치해 커버리지 손실도 없다.
   *
   * 기간을 못 받은 행은 NULL 로 남아 상시 장소처럼 다뤄진다 — 기간을 모르는 걸 "끝났다"로
   * 읽어 후보에서 빼는 것보다, 그대로 두고 다음 적재에서 채우는 쪽이 덜 틀린다.
   */
  private async attachEventPeriods(
    apiKey: string,
    lDongRegnCd: string,
    region: string,
    pending: Array<{ place: IngestPlace; contentTypeId: string }>,
    budget?: KtoCallBudget,
  ): Promise<void> {
    const festivals = pending.filter(
      ({ place, contentTypeId }) => contentTypeId === FESTIVAL_CONTENT_TYPE && place.tourismApiId,
    );
    if (festivals.length === 0) return;

    const periods = await this.fetchFestivalPeriods(apiKey, lDongRegnCd, budget);
    if (periods.size === 0) {
      this.logger.warn(
        `[${region}] 축제 ${festivals.length}건의 기간을 못 받았습니다 — 기간 없는 상시 장소로 적재됩니다.`,
      );
      return;
    }

    let filled = 0;
    for (const { place } of festivals) {
      const period = periods.get(place.tourismApiId!);
      if (!period) continue;
      place.eventStartDate = period.start;
      place.eventEndDate = period.end;
      filled += 1;
    }
    this.logger.log(`[${region}] 축제 기간 ${filled}/${festivals.length}건 채움`);
  }

  /** 시도의 축제 contentId → 행사 기간. searchFestival2 는 목록으로 기간을 준다. */
  private async fetchFestivalPeriods(
    apiKey: string,
    lDongRegnCd: string,
    budget?: KtoCallBudget,
  ): Promise<Map<string, { start: string; end: string }>> {
    const periods = new Map<string, { start: string; end: string }>();
    const numOfRows = 100;

    for (let page = 1; page <= FESTIVAL_MAX_PAGES; page += 1) {
      if (budget && !budget.consume()) break;
      try {
        const res = await axios.get<TourFestivalResponse>(`${this.BASE}/searchFestival2`, {
          params: {
            serviceKey: apiKey,
            numOfRows,
            pageNo: page,
            MobileOS: 'ETC',
            MobileApp: 'TriPick',
            _type: 'json',
            arrange: 'O',
            lDongRegnCd,
            // 시작일 하한. 오래전에 시작해 아직 진행 중인 행사까지 포함하려면 충분히 과거여야 한다.
            eventStartDate: FESTIVAL_SEARCH_FROM,
          },
          timeout: 15000,
        });
        if (detectKtoQuota(res.data)) {
          budget?.markExhausted();
          break;
        }
        const items = res.data.response?.body?.items;
        const rows = toArray(items && typeof items !== 'string' ? items.item : undefined);
        for (const row of rows) {
          const id = String(row.contentid ?? '').trim();
          const start = toIsoDate(row.eventstartdate);
          const end = toIsoDate(row.eventenddate);
          if (id && start && end) periods.set(id, { start, end });
        }
        if (rows.length < numOfRows) break;
      } catch (error) {
        this.logger.warn(
          `KTO searchFestival2 실패 (lDongRegnCd=${lDongRegnCd}, page=${page}): ${error instanceof Error ? error.message : String(error)}`,
        );
        break;
      }
    }
    return periods;
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
   * searchKeyword2(이름) 결과 중 좌표가 coords 와 {@link SAME_PLACE_RADIUS_M} 이내인 가장 가까운
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
        if (distanceM > SAME_PLACE_RADIUS_M) continue;
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
    classFilter?: FoodClassFilter,
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
          ...(classFilter?.lclsSystm2 ? { lclsSystm2: classFilter.lclsSystm2 } : {}),
          ...(classFilter?.lclsSystm3 ? { lclsSystm3: classFilter.lclsSystm3 } : {}),
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
      // HTTP 429 도 초과다 — 예산을 소진 처리하고 상위로 던져 남은 지역까지 헛돌지 않게 한다.
      if (isRateLimited(error)) {
        budget?.markExhausted();
        throw new KtoQuotaExceededError('areaBasedList2 (HTTP 429)');
      }
      this.logger.warn(
        `KTO areaBasedList2 실패 (lDongRegnCd=${lDongRegnCd}, page=${pageNo}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * 한 시도에서 특정 음식 분류에 속하는 contentId 를 전부 모은다. 카테고리 backfill 전용이라
   * 장소를 만들지 않고 id 만 돌려준다 — 고칠 대상은 이미 적재돼 있고, 필요한 건 "어느 행이
   * 카페인가" 뿐이다.
   *
   * 전국 한 번이 아니라 **시도별**로 도는 이유 — 한 목록이 작을수록 페이지 경계가 흔들릴 여지가
   * 적다. 시도별 카페는 평균 180건이라 대개 2페이지로 끝나고, 전체를 돌아도 KTO 호출은 40여 번이다.
   */
  async fetchFoodClassContentIds(
    lDongRegnCd: string,
    classFilter: FoodClassFilter,
    budget?: KtoCallBudget,
  ): Promise<string[]> {
    const apiKey = this.apiKey();
    if (!apiKey) return [];
    const ids = new Set<string>();
    const batchSize = 100; // KTO numOfRows 상한
    for (let page = 1; page <= FOOD_CLASS_MAX_PAGES; page += 1) {
      const rows = await this.fetchPage(
        apiKey,
        lDongRegnCd,
        page,
        batchSize,
        budget,
        FOOD_CONTENT_TYPE,
        classFilter,
      );
      for (const row of rows) {
        const id = String(row.contentid ?? '').trim();
        if (id) ids.add(id);
      }
      if (rows.length < batchSize) break;
    }
    return [...ids];
  }

  private toIngestPlace(row: TourAreaItem, region: string): IngestPlace | null {
    const lat = Number(row.mapy);
    const lng = Number(row.mapx);
    // KTO 가 일부 항목에 placeholder 좌표를 준다(실측: 3행이 전부 남중국해 `19.694, 117.993`).
    // non-finite·(0,0) 만 막던 시절엔 통과해 지도 마커가 바다에 찍히고 이동시간이 수천 km 가 됐다.
    if (!isPlausibleKoreanCoordinate({ lat, lng })) {
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

    // 쇼핑(38)에는 전통시장('경주 중앙시장')과 체인 매장·건물 입점 점포('다이소 부산서면점',
    // '구찌 롯데백화점 부산본점')가 섞여 온다. 후자는 방문할 여행지가 아니고, 좌표가 건물 좌표라
    // 반경 검색에서 한 건물의 매장들이 후보를 통째로 먹는다.
    if (contentTypeId === SHOPPING_CONTENT_TYPE && isRetailBranchOutlet(name, address)) {
      return null;
    }
    const sigungu = parseSigungu(address);
    // 음식(39)만 분류체계 중분류로 한 번 더 가른다 — 카페·찻집이 restaurant 로 뭉뚱그려지던 자리.
    const food = contentTypeId === FOOD_CONTENT_TYPE ? classifyTourFood(row) : null;
    const categoryDetail = food ? food.categoryDetail : CONTENT_TYPE_NAME[contentTypeId];

    return {
      tourismApiId: String(row.contentid),
      name,
      category: food ? food.category : category,
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
