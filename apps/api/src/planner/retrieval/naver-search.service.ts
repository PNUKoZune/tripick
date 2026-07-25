import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { regionSearchStem } from './place-seeds';
import type { PopularityIndex } from './types';

/** blog·cafearticle 공통 응답 형태 (필요한 필드만). */
interface NaverSearchResponse {
  total?: number;
  items?: Array<{
    title?: string;
    description?: string;
  }>;
}

const NAVER_BLOG_URL = 'https://naverapihub.apigw.ntruss.com/search/v1/blog';
const NAVER_CAFE_URL = 'https://naverapihub.apigw.ntruss.com/search/v1/cafearticle';
const NAVER_MAX_DISPLAY = 100;

/** 목적지 코퍼스를 만들 검색어 접미사. "경주 여행지 추천" 식으로 결합된다. */
const RECOMMEND_SUFFIXES = ['여행지 추천', '가볼만한 곳', '핫플레이스'] as const;

/** 언급 0 인 마이너 장소에 주는 하한 점수 (제거가 아닌 소프트 감점). */
const UNMENTIONED_SCORE = 0.15;
/** 인덱스 비활성(키 없음·조회 실패) 시 evaluator 가 쓰는 중립 점수. */
export const NEUTRAL_POPULARITY = 0.5;

/**
 * 네이버 블로그+카페 검색으로 "이 목적지에서 남들이 실제로 많이 가는 곳" 코퍼스를 모아
 * 후보 장소명의 언급 빈도를 조회하는 인덱스를 만든다.
 * 장소명 추출(불안정한 한글 NER) 대신, 깨끗한 후보 name 이 코퍼스에 몇 번 나오는지 세는
 * 역방향 매칭이라 마이너 장소는 자연히 언급 0 으로 걸러진다.
 */
@Injectable()
export class NaverSearchService {
  private readonly logger = new Logger(NaverSearchService.name);
  private readonly cache = new Map<string, { index: PopularityIndex; expires: number }>();

  constructor(private readonly config: ConfigService) {}

  /**
   * 목적지의 대중 인지도 인덱스를 반환한다. 키가 없거나 조회가 실패하면
   * 비활성 인덱스(모든 장소 중립)를 돌려 랭킹에 영향을 주지 않는다.
   * 목적지 단위로 TTL 캐시한다 (추천 글은 빠르게 바뀌지 않음).
   */
  async getPopularityIndex(destination: string): Promise<PopularityIndex> {
    const credentials = this.credentials();
    if (!credentials) return DISABLED_INDEX;

    const key = regionSearchStem(destination).toLowerCase() || destination.toLowerCase();
    // 서브지역(부산 해운대 등)까지 보존해야 그 지역의 인기 장소가 코퍼스에 잡힌다.
    const stem = regionSearchStem(destination) || destination;
    const queries = RECOMMEND_SUFFIXES.map((suffix) => `${stem} ${suffix}`);
    return this.buildIndex(`region:${key}`, queries, destination, credentials);
  }

  /**
   * 이번 달 국내 여행지 추천 코퍼스로 만든 인지도 인덱스. "2026년 7월 국내 여행지 추천" 식
   * 검색 결과에 어떤 여행지가 얼마나 등장하는지를 세어(역방향 매칭) 시기별 추천 후보를 고른다.
   * 월 단위로 캐시한다(같은 달 추천 글은 빠르게 바뀌지 않음). 키 없음·조회 실패 시 비활성 인덱스.
   */
  async getSeasonalDestinationIndex(now: Date = new Date()): Promise<PopularityIndex> {
    const credentials = this.credentials();
    if (!credentials) return DISABLED_INDEX;

    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const queries = [
      `${year}년 ${month}월 국내 여행지 추천`,
      `${month}월 여행지 추천`,
      `${month}월 국내여행 가볼만한 곳`,
    ];
    return this.buildIndex(`seasonal:${year}-${month}`, queries, `${year}년 ${month}월`, credentials);
  }

  /**
   * 검색어 목록으로 코퍼스를 모아 인지도 인덱스를 만든다(캐시 경유).
   * 두 엔드포인트가 모두 실패했거나 결과가 없으면 캐시하지 않고 비활성 반환 —
   * 다음 조회에서 재시도하도록 둔다(TTL 동안 빈 인덱스를 고정하지 않음).
   */
  private async buildIndex(
    cacheKey: string,
    queries: string[],
    label: string,
    credentials: { id: string; secret: string },
  ): Promise<PopularityIndex> {
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return cached.index;

    try {
      const corpus = await this.collectCorpus(queries, credentials);
      if (corpus.docCount === 0) {
        this.logger.warn(`네이버 코퍼스가 비어 인지도 보정 건너뜀 ("${label}")`);
        return DISABLED_INDEX;
      }
      const index = new NaverPopularityIndex(corpus.text, corpus.docCount);
      this.cache.set(cacheKey, { index, expires: Date.now() + this.cacheTtlMs() });
      this.logger.log(
        `네이버 인지도 인덱스 "${label}" docs=${corpus.docCount} chars=${corpus.text.length}`,
      );
      return index;
    } catch (error) {
      this.logger.warn(
        `네이버 검색 실패로 인지도 보정 건너뜀 ("${label}"): ${error instanceof Error ? error.message : String(error)}`,
      );
      return DISABLED_INDEX;
    }
  }

  /** 블로그·카페를 검색어별로 조회해 title+description 을 하나의 코퍼스로 합친다. */
  private async collectCorpus(
    queries: string[],
    credentials: { id: string; secret: string },
  ): Promise<{ text: string; docCount: number }> {
    const display = this.display();
    const parts: string[] = [];
    let docCount = 0;

    for (const query of queries) {
      // 블로그·카페 중 한쪽이 실패해도 나머지 코퍼스는 살린다(allSettled).
      const settled = await Promise.allSettled([
        this.search(NAVER_BLOG_URL, query, display, credentials),
        this.search(NAVER_CAFE_URL, query, display, credentials),
      ]);
      for (const result of settled) {
        if (result.status !== 'fulfilled') {
          this.logger.warn(
            `네이버 검색 일부 실패 ("${query}"): ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
          );
          continue;
        }
        for (const item of result.value) {
          parts.push(item);
          docCount += 1;
        }
      }
    }

    return { text: stripMarkup(parts.join(' ')), docCount };
  }

  private async search(
    url: string,
    query: string,
    display: number,
    credentials: { id: string; secret: string },
  ): Promise<string[]> {
    const res = await axios.get<NaverSearchResponse>(url, {
      params: { query, display, sort: 'sim', format: 'json' },
      headers: {
        'X-NCP-APIGW-API-KEY-ID': credentials.id,
        'X-NCP-APIGW-API-KEY': credentials.secret,
      },
      timeout: 5000,
    });
    return (res.data.items ?? []).map((item) => `${item.title ?? ''} ${item.description ?? ''}`);
  }

  private credentials(): { id: string; secret: string } | null {
    const id = this.config.get<string>('NAVER_SEARCH_CLIENT_ID', '');
    const secret = this.config.get<string>('NAVER_SEARCH_CLIENT_SECRET', '');
    if (!id || !secret) return null;
    return { id, secret };
  }

  private display(): number {
    const value = Number(this.config.get<string | number>('NAVER_SEARCH_DISPLAY', 30));
    if (!Number.isFinite(value) || value <= 0) return 30;
    return Math.min(NAVER_MAX_DISPLAY, Math.floor(value));
  }

  private cacheTtlMs(): number {
    const hours = Number(this.config.get<string | number>('NAVER_SEARCH_CACHE_TTL_HOURS', 6));
    return (Number.isFinite(hours) && hours > 0 ? hours : 6) * 60 * 60 * 1000;
  }
}

/** `<b>` 강조·HTML 엔티티를 제거하고 소문자로 정규화한다. */
function stripMarkup(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .toLowerCase();
}

/** 코퍼스 문자열을 들고 장소명 언급 빈도를 세는 인덱스. */
export class NaverPopularityIndex implements PopularityIndex {
  /** 공백을 제거한 코퍼스 — 장소명 띄어쓰기 차이(동궁과월지 vs 동궁과 월지)를 흡수한다. */
  private readonly compact: string;

  constructor(
    corpus: string,
    readonly docCount: number,
  ) {
    this.compact = corpus.replace(/\s+/g, '');
  }

  /** 정식명에 붙는 기관 수식어. 블로그는 보통 이걸 떼고 쓴다('국립경주박물관'→'경주박물관'). */
  private static readonly INSTITUTION_QUALIFIER = /(국립|도립|시립|공립|사립)/;
  /** 수식어를 뗀 코어를 매칭에 쓰기 위한 최소 길이. '도서관'·'극장' 같은 일반어 오탐 방지. */
  private static readonly MIN_CORE_LENGTH = 4;

  mentions(name: string): number {
    const needle = name.replace(/\s+/g, '').toLowerCase();
    // 1글자 장소명은 오탐이 심해 세지 않는다.
    if (needle.length < 2 || this.compact.length === 0) return 0;
    // 정식명이 블로그 표현보다 긴 경우(예: '국립경주박물관' vs '경주박물관')를 놓치지 않도록
    // 기관 수식어를 뗀 코어로 매칭한다. 코어는 정식명 언급까지 부분문자열로 포함하므로 더 정확하다.
    const core = needle.replace(NaverPopularityIndex.INSTITUTION_QUALIFIER, '');
    const key =
      core.length >= NaverPopularityIndex.MIN_CORE_LENGTH && core.length < needle.length
        ? core
        : needle;
    return this.countOccurrences(key);
  }

  private countOccurrences(needle: string): number {
    let count = 0;
    let from = this.compact.indexOf(needle);
    while (from !== -1) {
      count += 1;
      from = this.compact.indexOf(needle, from + needle.length);
    }
    return count;
  }

  score(name: string): number {
    const count = this.mentions(name);
    if (count === 0) return UNMENTIONED_SCORE;
    // 로그 스케일: 1회→0.63, 2회→0.74, 4회→0.87. 소수 언급도 완만하게 상승.
    return Math.min(1, 0.45 + 0.18 * Math.log2(count + 1));
  }
}

/** 키 없음·조회 실패 시 쓰는 무동작 인덱스 (모든 장소 중립 → 랭킹 불변). */
const DISABLED_INDEX: PopularityIndex = {
  docCount: 0,
  mentions: () => 0,
  score: () => NEUTRAL_POPULARITY,
};
