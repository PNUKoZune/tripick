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

/** 적재용 코퍼스: 원문 + 그 원문으로 만든 역방향 인덱스. */
export interface MentionCorpus {
  /** 마크업 제거·소문자화된 코퍼스 원문 (장소명 추출 입력) */
  text: string;
  docCount: number;
  /** 추출한 이름을 되짚어 확인하는 역방향 인덱스 */
  index: NaverPopularityIndex;
}

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

  /** 검색 키가 설정돼 있는지. 키가 없으면 모든 인지도 기능이 무동작이다. */
  hasCredentials(): boolean {
    return this.credentials() !== null;
  }

  /**
   * 적재 전용: 임의 검색어로 코퍼스를 모아 **원문과 역방향 인덱스를 함께** 돌려준다.
   * 런타임 인지도 조회와 달리 원문이 필요하다 — 적재는 코퍼스에서 장소명을 뽑아낸 뒤
   * 그 이름을 다시 인덱스로 되짚어 확인한다(`PopularPlaceService`).
   * 1회성 배치라 캐시하지 않는다. 키 없음·조회 실패·빈 코퍼스는 null.
   */
  async collectMentionCorpus(queries: string[], display?: number): Promise<MentionCorpus | null> {
    const credentials = this.credentials();
    if (!credentials) return null;

    try {
      const corpus = await this.collectCorpus(queries, credentials, display);
      if (corpus.docCount === 0) return null;
      return {
        text: corpus.text,
        docCount: corpus.docCount,
        index: new NaverPopularityIndex(corpus.text, corpus.docCount),
      };
    } catch (error) {
      this.logger.warn(
        `네이버 코퍼스 수집 실패 ("${queries[0] ?? ''}" 등): ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
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
    displayOverride?: number,
  ): Promise<{ text: string; docCount: number }> {
    const display = this.normalizeDisplay(displayOverride) ?? this.display();
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

  /**
   * 코퍼스 1회 조회당 문서 수 (네이버 상한 100).
   *
   * 기본값을 30 → 100 으로 올렸다. **호출 수는 그대로고 페이지만 커지므로 비용은 같은데**,
   * 코퍼스가 얇으면 대표 장소 언급이 아예 안 잡혀 인지도가 하한으로 떨어진다 — 실측에서
   * 대구 '서문시장' 이 30 에서는 언급 0(인지도 0.15, 17위)이고 100 에서는 상위로 올라왔다.
   * 골든셋 11케이스 기준 R|cat 0.337→0.377, MRR 0.514→0.650.
   */
  private display(): number {
    return this.normalizeDisplay(this.config.get<string | number>('NAVER_SEARCH_DISPLAY', 100)) ?? 100;
  }

  /**
   * 인지도 인덱스 캐시를 비운다 (평가 하네스 전용).
   *
   * 왜 필요한가 — 인덱스는 목적지 단위 6h TTL 캐시다. 하네스가 한 프로세스에서 파라미터 조합을
   * 돌리면 첫 조합이 만든 인덱스를 뒤 조합이 그대로 재사용해 **스윕이 조용히 무효가 된다**
   * (실측: NAVER_SEARCH_DISPLAY=30/60/100 이 소수점까지 동일하게 나왔다).
   */
  clearCache(): void {
    this.cache.clear();
  }

  /** 1..NAVER_MAX_DISPLAY 로 클램프. 값이 없거나 잘못되면 null. */
  private normalizeDisplay(raw: string | number | undefined): number | null {
    if (raw === undefined) return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return null;
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

  /**
   * 언급을 셀 수 있는 최소 이름 길이.
   *
   * 매칭이 부분문자열이라 2글자 상호는 코퍼스의 흔한 단어를 자기 언급으로 센다 — 실측에서
   * 대구 식당 '다시'가 코퍼스의 '다시'(부사) 6회를 먹고 인지도 0.95 로 1위에 올랐고,
   * '지금'·'공간'·'예전'·'이유' 도 같은 경로였다. 3글자부터는 한국 명소가 대거 걸려 있어
   * (한라산·비자림·불국사·석굴암·첨성대·무등산) 컷을 올릴 수 없다.
   *
   * 2글자는 세지 않고 **중립**으로 둔다 — 가점도 감점도 주지 않는다. 2글자 실제 명소('우도')는
   * 가점을 잃지만 감점도 없어 손해가 대칭이고, 일반어 상호가 1위를 먹는 손해보다 훨씬 작다.
   */
  private static readonly MIN_COUNTABLE_LENGTH = 3;

  /** 등록명을 쪼갤 구분자. '대구 서문시장 & 서문시장 야시장' 같은 장식적 등록명 대응. */
  private static readonly NAME_SPLIT = /[\s&,·/()[\]]+/;

  /**
   * 이름이 코퍼스 언급을 셀 수 있는 형태인지. 셀 수 없으면 null → 호출 측이 중립 처리한다.
   * (0 을 돌려주면 '언급 없는 마이너 장소'와 구분이 안 돼 감점 대상이 된다)
   */
  private countableNeedle(name: string): string | null {
    const needle = name.replace(/\s+/g, '').toLowerCase();
    if (needle.length < NaverPopularityIndex.MIN_COUNTABLE_LENGTH) return null;
    if (this.compact.length === 0) return null;
    return needle;
  }

  mentions(name: string): number {
    const needle = this.countableNeedle(name);
    if (!needle) return 0;
    for (const key of this.matchKeys(name, needle)) {
      const count = this.countOccurrences(key);
      if (count > 0) return count;
    }
    return 0;
  }

  /**
   * 시도할 매칭 키를 우선순위대로. 앞의 키가 하나라도 걸리면 거기서 멈춘다.
   *
   * 1. 정식명 전체 — 가장 정확
   * 2. 기관 수식어를 뗀 코어 ('국립경주박물관' → '경주박물관')
   * 3. 등록명 토큰 중 긴 것 — 지자체가 붙인 장식적 등록명은 통째로는 코퍼스에 없다.
   *    실측: '대구 서문시장 & 서문시장 야시장' 은 코퍼스 매칭 0 이라 인지도 하한(0.15)을 맞았는데,
   *    토큰 '서문시장' 으로는 13회다. 정답이 적재돼 있는데 상위에 못 오던 주요 원인.
   */
  private matchKeys(name: string, needle: string): string[] {
    const keys = [needle];

    const core = needle.replace(NaverPopularityIndex.INSTITUTION_QUALIFIER, '');
    if (core.length >= NaverPopularityIndex.MIN_CORE_LENGTH && core.length < needle.length) {
      keys.push(core);
    }

    // 토큰 폴백은 이름이 여러 토큰일 때만 의미가 있다(단일 토큰이면 needle 과 같다).
    const tokens = name
      .toLowerCase()
      .split(NaverPopularityIndex.NAME_SPLIT)
      .filter((token) => token.length >= NaverPopularityIndex.MIN_CORE_LENGTH);
    if (tokens.length > 1) {
      keys.push(...[...new Set(tokens)].sort((a, b) => b.length - a.length));
    }

    return keys;
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
    // 셀 수 없는 이름(2글자)은 중립 — 감점 대상인 '언급 0' 과 구분한다.
    if (!this.countableNeedle(name)) return NEUTRAL_POPULARITY;
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
