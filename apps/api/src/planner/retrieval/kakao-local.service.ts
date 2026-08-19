import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type { Coordinates, ReplanTrigger } from '@tripick/types';
import { inferPlaceTags, tasteTagsToKeywords } from './place-seeds';
import type { RawPlaceCandidate, RetrievalContext } from './types';

/** 키워드/카테고리 검색이 공통으로 돌려주는 장소 문서. */
interface KakaoDocument {
  id: string;
  place_name: string;
  category_name: string;
  category_group_code?: string;
  phone: string;
  address_name: string;
  road_address_name: string;
  x: string; // 경도(lng)
  y: string; // 위도(lat)
  distance?: string;
}

interface KakaoSearchResponse {
  documents?: KakaoDocument[];
  meta?: {
    total_count?: number;
    pageable_count?: number;
    is_end?: boolean;
  };
}

/**
 * 적재·검색에 사용할 카카오 category_group_code.
 * CT1 문화시설 · AT4 관광명소 · FD6 음식점 · CE7 카페.
 * (숙박 AD5 는 여행 일정 후보로 직접 고르지 않아 제외 — 필요 시 KTO 가 커버)
 */
export const KAKAO_CATEGORY_CODES = ['CT1', 'AT4', 'FD6', 'CE7'] as const;
export type KakaoCategoryCode = (typeof KAKAO_CATEGORY_CODES)[number];

/** 트리거 없음(최초 생성) 기본 키워드. */
const DEFAULT_KEYWORDS = ['관광지', '맛집', '카페'];

/**
 * 트리거별 후보 검색 키워드. `Record<ReplanTrigger, …>` 라 ReplanTrigger 에 값이 늘면 여기서
 * 컴파일 에러로 잡힌다 — 삼항 체인 시절엔 새 트리거가 조용히 기본 키워드로 떨어졌다.
 * NOTE: 세 재계획 트리거 모두 '맛집' 계열 키워드가 없어 후보 풀에 restaurant 가 얇게 잡힌다
 * (기본 경로에만 있음). 별도 건으로 다룬다 — 여기선 분기 구조만 표로 옮긴다.
 */
const TRIGGER_KEYWORDS: Record<ReplanTrigger, string[]> = {
  weather: ['실내 관광', '박물관', '카페'],
  deviation: ['근처 관광지', '근처 카페'],
  crowd: ['한적한 관광지', '숨은 명소', '카페'],
  manual: DEFAULT_KEYWORDS,
};

/** category_group_code → 내부 category 라벨 매핑. */
const CATEGORY_GROUP_TO_CATEGORY: Record<string, string> = {
  CT1: 'attraction',
  AT4: 'attraction',
  FD6: 'restaurant',
  CE7: 'cafe',
  AD5: 'accommodation',
};

const KAKAO_KEYWORD_URL = 'https://dapi.kakao.com/v2/local/search/keyword.json';
const KAKAO_CATEGORY_URL = 'https://dapi.kakao.com/v2/local/search/category.json';
const KAKAO_MAX_RADIUS_M = 20000; // 카카오 radius 상한
const KAKAO_PAGE_SIZE = 15; // 페이지당 최대 문서 수

/**
 * 카테고리 검색이 한 질의로 돌려주는 **문서 상한 45건**(= 3페이지). `page=4` 는 에러가 아니라
 * 3페이지와 같은 내용을 다시 준다 — `meta.pageable_count` 도 45 로 잘려 온다.
 *
 * 45 를 "최대 페이지"로 알고 있던 게 적재 커버리지를 갉아먹고 있었다. 실측(부산 전포동 중심,
 * AT4): 반경 10km 안에 `total_count` 378 건인데 도달 가능한 건 45 건뿐이고, 그 45 건은
 * 거리순이라 **0~3.6km 안에서 끝난다.** 즉 반경을 10km 로 넓혀도 실제로 걷히는 건 3km 원 하나다.
 * 앵커를 10km 간격으로 놓으면 그 사이가 통째로 안 걷힌다.
 */
const KAKAO_CATEGORY_MAX_RESULTS = 45;
const KAKAO_MAX_PAGE = KAKAO_CATEGORY_MAX_RESULTS / KAKAO_PAGE_SIZE;

interface KeywordSearchOptions {
  center?: Coordinates;
  radius?: number;
  categoryGroupCode?: string;
}

/**
 * 목적지 앵커 해석용 최소 문서.
 *
 * `RawPlaceCandidate` 로는 부족해서 따로 둔다 — 앵커 선별은 (a) `category_group_code` 로
 * 주차장·숙박 같은 "그 자체가 목적지가 아닌" 문서를 걸러야 하고, (b) 지역 코드를 **지번 주소**
 * 에서 파생해야 한다. `mapDocument` 는 group code 를 내부 라벨로 접어 버리고 주소도
 * 도로명 우선이라 둘 다 잃는다(도로명은 비어 오는 문서가 있다 — 실측: 광안리 공영주차장).
 */
export interface KakaoPlaceBrief {
  name: string;
  /** 지번 주소(address_name). 항상 채워져 시도·시군구 토큰의 정본으로 쓴다. */
  address: string;
  coordinates: Coordinates;
  categoryGroupCode: string | null;
}

@Injectable()
export class KakaoLocalService {
  private readonly logger = new Logger(KakaoLocalService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * 런타임 CRAG fallback: 목적지·취향 키워드로 장소를 검색한다.
   * 현재 위치(currentLocation)가 있으면 x/y/radius 로 지역을 묶어 타지역 동명 장소 누수를 막는다.
   */
  async search(context: RetrievalContext, limit: number): Promise<RawPlaceCandidate[]> {
    const apiKey = this.apiKey();
    if (!apiKey) return [];

    const keywords = this.buildKeywords(context);
    // 현재 위치(재계획)가 1순위, 없으면 목적지 앵커. 앵커가 있으면 그 반경이 곧 검색 반경이라
    // '광안리 카페' 질의가 타지역 동명 카페를 물어오는 걸 좌표로 막는다 — 키워드 검색은
    // 지역명을 문자열로만 붙이므로 좌표를 안 주면 전국이 사정권이다.
    const opts: KeywordSearchOptions | undefined = context.currentLocation
      ? { center: context.currentLocation, radius: this.searchRadius() }
      : context.anchor
        ? { center: context.anchor.coordinates, radius: context.anchor.radiusM }
        : undefined;

    const collected: RawPlaceCandidate[] = [];
    const seen = new Set<string>();

    for (const keyword of keywords) {
      if (collected.length >= limit) break;
      const places = await this.searchKeyword(
        apiKey,
        keyword,
        Math.min(KAKAO_PAGE_SIZE, limit),
        opts,
      );
      for (const place of places) {
        const key = place.kakaoPlaceId ?? `${place.name}:${place.address}`;
        if (seen.has(key)) continue;
        seen.add(key);
        collected.push(place);
        if (collected.length >= limit) break;
      }
    }

    return collected;
  }

  /**
   * 적재용: 한 앵커 좌표를 중심으로 4개 category_group_code 를 순회하며
   * 카테고리 검색(search/category)으로 장소를 모은다. 위치+카테고리 기반이라
   * 키워드 검색과 달리 타지역 동명 장소가 섞이지 않는다.
   */
  async searchAround(
    center: Coordinates,
    radius: number,
    limitPerCategory: number,
  ): Promise<RawPlaceCandidate[]> {
    const apiKey = this.apiKey();
    if (!apiKey) return [];

    const collected: RawPlaceCandidate[] = [];
    for (const code of KAKAO_CATEGORY_CODES) {
      const places = await this.searchByCategory(apiKey, code, center, radius, limitPerCategory);
      collected.push(...places);
    }
    return collected;
  }

  /**
   * 적재 fallback: 관광공사 좌표가 없어 앵커를 못 뽑을 때 지역명을 지오코딩해
   * 지역 중심 좌표 1개를 얻는다.
   */
  async resolveCenter(region: string): Promise<Coordinates | null> {
    const apiKey = this.apiKey();
    if (!apiKey) return null;
    const docs = await this.searchKeyword(apiKey, region, 1);
    return docs[0]?.coordinates ?? null;
  }

  /**
   * 장소 이름 검색용: 사용자가 입력한 장소명/키워드로 키워드 검색.
   * center 가 있으면 그 주변을 우선한다.
   */
  async searchByText(
    keyword: string,
    limit: number,
    center?: Coordinates,
    radius?: number,
  ): Promise<RawPlaceCandidate[]> {
    const apiKey = this.apiKey();
    if (!apiKey) return [];
    const opts = center ? { center, radius: radius ?? KAKAO_MAX_RADIUS_M } : undefined;
    return this.searchKeyword(apiKey, keyword, limit, opts);
  }

  private async searchByCategory(
    apiKey: string,
    categoryGroupCode: KakaoCategoryCode,
    center: Coordinates,
    radius: number,
    limit: number,
  ): Promise<RawPlaceCandidate[]> {
    const results: RawPlaceCandidate[] = [];
    const maxPage = Math.min(KAKAO_MAX_PAGE, Math.max(1, Math.ceil(limit / KAKAO_PAGE_SIZE)));

    for (let page = 1; page <= maxPage; page += 1) {
      try {
        const res = await axios.get<KakaoSearchResponse>(KAKAO_CATEGORY_URL, {
          params: {
            category_group_code: categoryGroupCode,
            x: center.lng,
            y: center.lat,
            radius: Math.min(radius, KAKAO_MAX_RADIUS_M),
            page,
            size: KAKAO_PAGE_SIZE,
            sort: 'accuracy',
          },
          headers: { Authorization: `KakaoAK ${apiKey}` },
          timeout: 5000,
        });

        for (const doc of res.data.documents ?? []) {
          const candidate = this.mapDocument(doc);
          if (candidate) results.push(candidate);
          if (results.length >= limit) return results;
        }
        if (res.data.meta?.is_end) break;
      } catch (error) {
        this.logger.warn(
          `Kakao category search 실패 (${categoryGroupCode}, page=${page}): ${error instanceof Error ? error.message : String(error)}`,
        );
        break;
      }
    }

    return results;
  }

  /**
   * 목적지 문자열을 좌표로 해석하기 위한 키워드 검색.
   * 후보를 일정에 넣을 장소가 아니라 **앵커 후보**로 다루므로 원본 필드를 그대로 돌려준다.
   */
  async searchBrief(query: string, limit: number): Promise<KakaoPlaceBrief[]> {
    const apiKey = this.apiKey();
    if (!apiKey) return [];
    const docs = await this.fetchKeywordDocuments(apiKey, query, limit);
    return docs.flatMap((doc) => {
      const lat = Number(doc.y);
      const lng = Number(doc.x);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
      return [
        {
          name: doc.place_name,
          address: doc.address_name,
          coordinates: { lat, lng },
          categoryGroupCode: doc.category_group_code || null,
        },
      ];
    });
  }

  private async searchKeyword(
    apiKey: string,
    keyword: string,
    limit: number,
    opts?: KeywordSearchOptions,
  ): Promise<RawPlaceCandidate[]> {
    const docs = await this.fetchKeywordDocuments(apiKey, keyword, limit, opts);
    return docs.flatMap((doc) => {
      const candidate = this.mapDocument(doc);
      return candidate ? [candidate] : [];
    });
  }

  private async fetchKeywordDocuments(
    apiKey: string,
    keyword: string,
    limit: number,
    opts?: KeywordSearchOptions,
  ): Promise<KakaoDocument[]> {
    try {
      const params: Record<string, unknown> = {
        query: keyword,
        size: Math.min(KAKAO_PAGE_SIZE, limit),
      };
      if (opts?.center) {
        params.x = opts.center.lng;
        params.y = opts.center.lat;
        params.radius = Math.min(opts.radius ?? KAKAO_MAX_RADIUS_M, KAKAO_MAX_RADIUS_M);
      }
      if (opts?.categoryGroupCode) {
        params.category_group_code = opts.categoryGroupCode;
      }

      const res = await axios.get<KakaoSearchResponse>(KAKAO_KEYWORD_URL, {
        params,
        headers: { Authorization: `KakaoAK ${apiKey}` },
        timeout: 5000,
      });

      return res.data.documents ?? [];
    } catch (error) {
      this.logger.warn(
        `Kakao Local fallback failed for "${keyword}": ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /** 키워드/카테고리 공통 문서 → RawPlaceCandidate 변환. */
  private mapDocument(doc: KakaoDocument): RawPlaceCandidate | null {
    const lat = Number(doc.y);
    const lng = Number(doc.x);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    const category = this.categoryFromKakao(doc.category_group_code, doc.category_name);
    const place = {
      id: `kakao-${doc.id}`,
      kakaoPlaceId: doc.id,
      name: doc.place_name,
      category,
      address: doc.road_address_name || doc.address_name,
      coordinates: { lat, lng },
      ...(doc.road_address_name ? { roadAddress: doc.road_address_name } : {}),
      ...(doc.phone ? { phone: doc.phone } : {}),
    };

    return {
      ...place,
      source: 'kakao' as const,
      tags: inferPlaceTags({ ...place, categoryDetail: doc.category_name }),
      ...(doc.category_name ? { categoryDetail: doc.category_name } : {}),
      ...(doc.distance ? { distanceM: Number(doc.distance) } : {}),
    };
  }

  private buildKeywords(context: RetrievalContext): string[] {
    const tasteKeywords = tasteTagsToKeywords(context.tasteTags).slice(0, 4);
    const triggerKeywords = context.trigger
      ? TRIGGER_KEYWORDS[context.trigger]
      : DEFAULT_KEYWORDS;

    const keywords = [
      ...tasteKeywords.map((tag) => `${context.destination} ${tag}`),
      ...triggerKeywords.map((keyword) => `${context.destination} ${keyword}`),
      context.destination,
    ];
    return [...new Set(keywords)];
  }

  /** group code 를 우선 신뢰하고, 없으면 category_name 문자열로 추정한다. */
  private categoryFromKakao(groupCode: string | undefined, categoryName: string): string {
    if (groupCode && CATEGORY_GROUP_TO_CATEGORY[groupCode]) {
      return CATEGORY_GROUP_TO_CATEGORY[groupCode];
    }
    if (categoryName.includes('카페')) return 'cafe';
    if (categoryName.includes('음식점')) return 'restaurant';
    if (categoryName.includes('숙박')) return 'accommodation';
    if (categoryName.includes('문화') || categoryName.includes('관광')) return 'attraction';
    return 'attraction';
  }

  private apiKey(): string {
    return (
      this.config.get<string>('KAKAO_LOCAL_API_KEY') ??
      this.config.get<string>('KAKAO_REST_API_KEY', '')
    );
  }

  /** 런타임 키워드 검색 반경 (currentLocation 이 있을 때만 적용). */
  private searchRadius(): number {
    const value = Number(this.config.get<string | number>('KAKAO_SEARCH_RADIUS_M', 20000));
    return Number.isFinite(value) && value > 0 ? Math.min(value, KAKAO_MAX_RADIUS_M) : KAKAO_MAX_RADIUS_M;
  }
}
