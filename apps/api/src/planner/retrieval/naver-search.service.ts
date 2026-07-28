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

/**
 * 지역명이 없는 전국 추천 코퍼스를 만들 검색어. **지역 특이도의 분모**로만 쓴다.
 *
 * 왜 필요한가 — 역방향 매칭은 이름이 코퍼스에 몇 번 나오는지만 세므로, 이름이 흔한 한국어
 * 단어인 상호는 남의 언급을 자기 것으로 가져간다(실측: 식당 '맛있게' 가 대구 맛집 코퍼스에서
 * 12회, 카페 '연다'·'담다' 도 같은 경로). 이름 길이·접미사 휴리스틱으로는 실제 상호와 구분이
 * 안 되지만, **일반어는 어느 지역 코퍼스에서나 비슷한 비율로 나오고 실제 장소는 자기 지역
 * 코퍼스에만 몰린다**. 그래서 지역 무관 코퍼스를 대조군으로 두고 언급률 비를 본다.
 */
const CONTROL_QUERIES = ['국내 여행지 추천', '국내 맛집 추천', '가볼만한 곳 추천'] as const;

/**
 * 지역 특이도 하한 — 지역 코퍼스 언급률이 대조 코퍼스 언급률의 몇 배 이상이어야
 * "그 지역의 인기 장소"로 인정할지.
 *
 * 기본 5 는 실측으로 갈랐다(제주·대구·광주 × 명소·맛집 축, 코퍼스 각 600건):
 *   실제 장소 — 성산일출봉 9.25 / 한라산 9.50 / 팔공산·서문시장·돈사돈·따로국밥 ∞(대조 0)
 *   일반어    — 맛있게 4.00 / 네이버 3.33 / 조금더 0.50
 * 두 무리 사이가 4~6 에서 비어 있어 5 를 뒀다. 대조 코퍼스에 아예 없는 이름(∞)은 항상 통과.
 */
const DEFAULT_MIN_REGION_SPECIFICITY = 5;

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
 *
 * 역방향 매칭의 대가는 **이름이 흔한 단어인 상호가 남의 언급을 가져가는 것**이다. 그래서
 * 지역명 없는 전국 코퍼스(CONTROL_QUERIES)를 대조군으로 함께 만들어, 두 코퍼스에서 비슷한
 * 비율로 나오는 이름은 인지도 가점 대상에서 빼고 중립으로 둔다.
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
    const region = await this.buildIndex(`region:${key}`, queries, destination, credentials);
    if (region.docCount === 0) return region;

    // 대조 코퍼스는 목적지와 무관하므로 캐시 1건으로 전 목적지가 공유한다(6h 당 6콜).
    // 실패하면 필터 없이 지역 인덱스만 쓴다 — 보정을 못 하는 것이지 랭킹이 망가지진 않는다.
    const control = await this.getControlIndex();
    if (!control) return region;
    return new RegionSpecificPopularityIndex(region, control, this.minRegionSpecificity());
  }

  /**
   * 지역명 없는 전국 추천 코퍼스 인덱스 (지역 특이도의 분모). 키 없음·조회 실패 시 null.
   * 적재(PopularPlaceService)와 런타임 랭킹이 같은 대조군을 공유한다.
   */
  async getControlIndex(): Promise<PopularityIndex | null> {
    const credentials = this.credentials();
    if (!credentials) return null;
    const control = await this.buildIndex(
      'control:national',
      [...CONTROL_QUERIES],
      '전국 대조',
      credentials,
    );
    return control.docCount > 0 ? control : null;
  }

  /** 지역 특이도 하한. 근거는 DEFAULT_MIN_REGION_SPECIFICITY 주석 참고. */
  minRegionSpecificity(): number {
    const value = Number(
      this.config.get<string | number>(
        'NAVER_MIN_REGION_SPECIFICITY',
        DEFAULT_MIN_REGION_SPECIFICITY,
      ),
    );
    return Number.isFinite(value) && value >= 0 ? value : DEFAULT_MIN_REGION_SPECIFICITY;
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
  /** 공백을 살린 코퍼스 — 짧은 이름은 공백을 건너뛴 매칭을 인정하지 않는다(아래 SHORT_NAME_LENGTH). */
  private readonly spaced: string;

  constructor(
    corpus: string,
    readonly docCount: number,
  ) {
    this.compact = corpus.replace(/\s+/g, '');
    this.spaced = corpus.replace(/\s+/g, ' ');
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

  /**
   * 이 길이까지는 **공백을 살린 코퍼스**에서만 언급을 센다.
   *
   * compact 매칭(공백 제거)은 '동궁과 월지'↔'동궁과월지' 를 흡수하려고 넣은 것인데, 짧은
   * 이름에선 공백을 건너뛰어 남의 문장을 자기 언급으로 만든다 — 실측에서 광주 식당 '조금더'가
   * 본문의 '조금 더' 를 먹었다. 3글자 명소(한라산·불국사·석굴암)는 블로그에서도 붙여 쓰므로
   * 공백을 살려도 그대로 걸린다. 여기서 공백 매칭이 0 인데 compact 매칭은 잡히는 이름은
   * **판정 불가(중립)** 로 둔다 — 감점(0.15)까지 주면 띄어 쓴 실제 짧은 이름이 손해를 본다.
   */
  private static readonly SHORT_NAME_LENGTH = 3;

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
    return this.count(name).mentions;
  }

  /**
   * 언급 수와 **판정 가능 여부**를 함께 돌려준다. countable=false 는 "이 이름으로는 셀 수 없음"
   * (2글자 이하 / 짧은 이름이 공백을 건너뛴 매칭만 걸림)이라 점수를 중립으로 둬야 한다.
   */
  private count(name: string): { countable: boolean; mentions: number } {
    const needle = this.countableNeedle(name);
    if (!needle) return { countable: false, mentions: 0 };

    const short = needle.length <= NaverPopularityIndex.SHORT_NAME_LENGTH;
    const haystack = short ? this.spaced : this.compact;
    for (const key of this.matchKeys(name, needle)) {
      const count = this.countOccurrences(key, haystack);
      if (count > 0) return { countable: true, mentions: count };
    }
    // 짧은 이름이 공백 제거 코퍼스에서만 걸리면 남의 언급일 가능성이 크다 → 판정 보류.
    if (short && this.countOccurrences(needle, this.compact) > 0) {
      return { countable: false, mentions: 0 };
    }
    return { countable: true, mentions: 0 };
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

  private countOccurrences(needle: string, haystack: string): number {
    let count = 0;
    let from = haystack.indexOf(needle);
    while (from !== -1) {
      count += 1;
      from = haystack.indexOf(needle, from + needle.length);
    }
    return count;
  }

  score(name: string): number {
    const { countable, mentions } = this.count(name);
    // 셀 수 없는 이름(2글자·공백 건너뛴 매칭)은 중립 — 감점 대상인 '언급 0' 과 구분한다.
    if (!countable) return NEUTRAL_POPULARITY;
    if (mentions === 0) return UNMENTIONED_SCORE;
    // 로그 스케일: 1회→0.63, 2회→0.74, 4회→0.87. 소수 언급도 완만하게 상승.
    return Math.min(1, 0.45 + 0.18 * Math.log2(mentions + 1));
  }
}

/**
 * 지역 특이도 = 지역 코퍼스 언급률 / 대조 코퍼스 언급률.
 * 대조 코퍼스에 없는 이름은 Infinity(그 지역에서만 쓰이는 고유명), 지역 코퍼스에 없으면 0.
 */
export function mentionSpecificity(
  name: string,
  region: PopularityIndex,
  control: PopularityIndex,
): number {
  const regionMentions = region.mentions(name);
  if (regionMentions === 0) return 0;
  if (region.docCount === 0 || control.docCount === 0) return Infinity;
  const controlMentions = control.mentions(name);
  if (controlMentions === 0) return Infinity;
  return regionMentions / region.docCount / (controlMentions / control.docCount);
}

/**
 * 지역 코퍼스 인덱스에 **대조 코퍼스 필터**를 씌운 인덱스.
 * 특이도가 하한 미만인 이름(= 전국 어디서나 쓰이는 흔한 한국어 단어를 상호로 쓴 장소)은
 * 가점도 감점도 주지 않고 중립으로 둔다. 실제 언급이 있는 장소만 인지도 가점을 받는다.
 */
export class RegionSpecificPopularityIndex implements PopularityIndex {
  constructor(
    private readonly region: PopularityIndex,
    private readonly control: PopularityIndex,
    private readonly minSpecificity: number,
  ) {}

  get docCount(): number {
    return this.region.docCount;
  }

  /** 이름이 이 지역 고유의 언급을 가진 것으로 인정되는지. */
  isRegionSpecific(name: string): boolean {
    return mentionSpecificity(name, this.region, this.control) >= this.minSpecificity;
  }

  mentions(name: string): number {
    return this.isRegionSpecific(name) ? this.region.mentions(name) : 0;
  }

  score(name: string): number {
    // 언급 자체가 없는 마이너 장소는 기존대로 감점(하한)이고, '일반어를 상호로 쓴 장소'만 중립이다.
    if (this.region.mentions(name) === 0) return this.region.score(name);
    return this.isRegionSpecific(name) ? this.region.score(name) : NEUTRAL_POPULARITY;
  }
}

/** 키 없음·조회 실패 시 쓰는 무동작 인덱스 (모든 장소 중립 → 랭킹 불변). */
const DISABLED_INDEX: PopularityIndex = {
  docCount: 0,
  mentions: () => 0,
  score: () => NEUTRAL_POPULARITY,
};
