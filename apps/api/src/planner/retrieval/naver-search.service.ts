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
/** 1회 언급의 점수 = 이 값 + slope. 언급 0(0.15)과 확실히 갈라 놓는 바닥. */
const MENTION_SCORE_BASE = 0.45;
/**
 * 언급 수 → 점수의 로그 기울기. `min(1, 0.45 + slope*log2(m+1))` 이라 **기울기가 곧 포화 지점**이다.
 *
 * 종전 0.18 은 언급 8회에서 1.00 에 닿는다. 전체 풀에서는 문제가 안 보인다 — 후보 80.2%가
 * 언급 0(0.15)이라 popularity AUC 0.763 으로 가장 센 항이다. 문제는 **상위 16 안**이다:
 * 실측에서 top-16 의 41~53%가 정확히 1.00 이고 confidence 전체 스프레드가 0.039 로 눌린다.
 * 정답을 가려야 하는 바로 그 구간에서 제일 센 신호가 평평해지는 것이다.
 * (경주 실측: 불국사·석굴암·대릉원이 '추억의달동네'·'코스믹 리조트'·'키덜트뮤지엄' 뒤로 밀렸다)
 *
 * 스윕(`NAVER_POPULARITY_LOG_SLOPE`, 한 프로세스 연속 측정):
 *
 * | slope | 포화 지점 | top-16 포화율 | R@5 | R@10 | R\|cat | MRR |
 * | --- | --- | --- | --- | --- | --- | --- |
 * | 0.18 | 8회 | 40% | 0.228 | 0.408 | 0.475 | 0.690 |
 * | **0.12** | **23회** | **16%** | **0.263** | **0.408** | **0.487** | **0.716** |
 * | 0.09 | 63회 | 3% | 0.264 | 0.385 | 0.481 | 0.809 |
 * | 0.07 | 141회 | 0% | 0.246 | 0.392 | 0.500 | 0.775 |
 * | 0.05 | — | 0% | 0.223 | 0.343 | 0.494 | 0.691 |
 *
 * 0.12 가 무릎이다 — 속초 0.40→0.50, 서면역 0.42→0.50 이 오르고 **내려가는 케이스가 없다.**
 * 그 아래부터는 맞바꾸기가 시작된다(0.09 는 MRR 0.809 로 제일 높지만 강릉 0.60→0.50 ·
 * 광안리 0.64→0.55 를 내주고 R@10 도 0.385 로 떨어진다). 포화를 0%까지 없애는 게 목표가 아니라,
 * **상위 16 이 평평해지지 않을 만큼만** 미루는 것이 목표다.
 */
const DEFAULT_MENTION_LOG_SLOPE = 0.12;

/** 앞머리 토큰 배제 스위치 (스윕용). {@link NaverPopularityIndex.dropLeadingQualifier} 참고. */
function leadingQualifierDropEnabled(): boolean {
  const raw = process.env.NAVER_POPULARITY_DROP_LEADING_TOKEN;
  return raw === undefined || String(raw).trim() === '' ? true : String(raw).trim() !== 'false';
}
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
  /** 같은 cache miss가 겹치면 외부 요청 한 벌만 실행한다(thundering herd 방지). */
  private readonly inFlight = new Map<string, Promise<PopularityIndex>>();

  constructor(private readonly config: ConfigService) {}

  /**
   * 목적지의 대중 인지도 인덱스를 반환한다. 키가 없거나 조회가 실패하면
   * 비활성 인덱스(모든 장소 중립)를 돌려 랭킹에 영향을 주지 않는다.
   * 목적지 단위로 TTL 캐시한다 (추천 글은 빠르게 바뀌지 않음).
   */
  /** 언급 수 → 점수의 로그 기울기. {@link DEFAULT_MENTION_LOG_SLOPE} 참고. */
  private mentionLogSlope(): number {
    const raw = this.config.get<string>('NAVER_POPULARITY_LOG_SLOPE');
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      return DEFAULT_MENTION_LOG_SLOPE;
    }
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_MENTION_LOG_SLOPE;
  }

  async getPopularityIndex(destination: string): Promise<PopularityIndex> {
    const credentials = this.credentials();
    if (!credentials) return DISABLED_INDEX;

    const key = regionSearchStem(destination).toLowerCase() || destination.toLowerCase();
    // 서브지역(부산 해운대 등)까지 보존해야 그 지역의 인기 장소가 코퍼스에 잡힌다.
    const stem = regionSearchStem(destination) || destination;
    const queries = RECOMMEND_SUFFIXES.map((suffix) => `${stem} ${suffix}`);
    // 지역·전국 대조 코퍼스는 서로 독립이다. 콜드 캐시에서 직렬로 기다리지 않는다.
    const [region, control] = await Promise.all([
      this.buildIndex(`region:${key}`, queries, destination, credentials),
      this.getControlIndex(),
    ]);
    if (region.docCount === 0) return region;

    // 대조 코퍼스는 목적지와 무관하므로 캐시 1건으로 전 목적지가 공유한다(6h 당 6콜).
    // 실패하면 필터 없이 지역 인덱스만 쓴다 — 보정을 못 하는 것이지 랭킹이 망가지진 않는다.
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
    return this.buildIndex(
      `seasonal:${year}-${month}`,
      queries,
      `${year}년 ${month}월`,
      credentials,
    );
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
        index: new NaverPopularityIndex(corpus.text, corpus.docCount, this.mentionLogSlope()),
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

    const running = this.inFlight.get(cacheKey);
    if (running) return running;

    const pending = this.buildIndexUncached(cacheKey, queries, label, credentials);
    this.inFlight.set(cacheKey, pending);
    try {
      return await pending;
    } finally {
      // clearCache 뒤 같은 키로 새 작업이 시작됐으면 새 Promise를 지우지 않는다.
      if (this.inFlight.get(cacheKey) === pending) this.inFlight.delete(cacheKey);
    }
  }

  private async buildIndexUncached(
    cacheKey: string,
    queries: string[],
    label: string,
    credentials: { id: string; secret: string },
  ): Promise<PopularityIndex> {
    try {
      const corpus = await this.collectCorpus(queries, credentials);
      if (corpus.docCount === 0) {
        this.logger.warn(`네이버 코퍼스가 비어 인지도 보정 건너뜀 ("${label}")`);
        return DISABLED_INDEX;
      }
      const index = new NaverPopularityIndex(corpus.text, corpus.docCount, this.mentionLogSlope());
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
    const results = new Array<{ parts: string[]; docCount: number }>(queries.length);
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < queries.length) {
        const index = cursor;
        cursor += 1;
        const query = queries[index]!;
        // 블로그·카페 중 한쪽이 실패해도 나머지 코퍼스는 살린다(allSettled).
        const settled = await Promise.allSettled([
          this.search(NAVER_BLOG_URL, query, display, credentials),
          this.search(NAVER_CAFE_URL, query, display, credentials),
        ]);
        const parts: string[] = [];
        let docCount = 0;
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
        results[index] = { parts, docCount };
      }
    };

    const concurrency = Math.min(queries.length, this.searchConcurrency());
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    const parts = results.flatMap((result) => result?.parts ?? []);
    const docCount = results.reduce((sum, result) => sum + (result?.docCount ?? 0), 0);

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
    return (
      this.normalizeDisplay(this.config.get<string | number>('NAVER_SEARCH_DISPLAY', 100)) ?? 100
    );
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
    this.inFlight.clear();
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

  /** 검색어 묶음 동시 처리 수. 각 묶음 안에서는 blog+cafe 두 요청이 함께 돈다. */
  private searchConcurrency(): number {
    const value = Number(this.config.get<string | number>('NAVER_SEARCH_CONCURRENCY', 2));
    return Number.isFinite(value) && value > 0 ? Math.min(4, Math.floor(value)) : 2;
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
    private readonly logSlope: number = DEFAULT_MENTION_LOG_SLOPE,
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
  /** 등록명 구분자 중 **공백이 아닌 것**. 있으면 장식적 등록명으로 본다. */
  private static readonly DECORATIVE_SPLIT = /[&,·/()[\]]/;

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

    // 괄호 안 구분자를 뗀 이름. 카탈로그엔 동명이지를 가르려고 '사직공원(광주)'·'동궁과월지(안압지)'
    // 처럼 등록돼 있는데, 블로그는 괄호 없이 쓰므로 전체명 매칭이 0 이 된다. 실측에서 광주 정답
    // '사직공원' 의 실제 행이 인지도 하한(0.15)을 맞고, 대신 '사직공원 전망타워' 가 모(母)장소
    // 언급을 물려받아 그 자리를 차지했다.
    const unparenthesized = needle.replace(/\([^)]*\)/g, '');
    if (
      unparenthesized.length >= NaverPopularityIndex.MIN_CORE_LENGTH &&
      unparenthesized.length < needle.length
    ) {
      keys.push(unparenthesized);
    }

    // 토큰 폴백은 이름이 여러 토큰일 때만 의미가 있다(단일 토큰이면 needle 과 같다).
    const tokens = name
      .toLowerCase()
      .split(NaverPopularityIndex.NAME_SPLIT)
      .filter((token) => token.length >= NaverPopularityIndex.MIN_CORE_LENGTH);
    if (tokens.length > 1) {
      const usable = this.dropLeadingQualifier(name, tokens);
      keys.push(...[...new Set(usable)].sort((a, b) => b.length - a.length));
    }

    return keys;
  }

  /**
   * 앞머리 토큰을 매칭 키에서 뺀다 — 한국어 장소명에서 앞에 붙는 토큰은 그 장소의 정체성이
   * 아니라 **담고 있는 것**(행정구역·모시설)이다. 뒤가 정체성이다.
   *
   * 토큰 폴백은 장식적 등록명을 살리려고 넣었는데('대구 서문시장 & 서문시장 야시장' → '서문시장')
   * 앞머리까지 열어 두는 바람에 남의 인지도를 물려받는 통로가 됐다. 골든셋 상위 16 계측에서
   * **36/248(14.5%)** 이 전체명 언급 0 인데 토큰으로만 점수를 얻었고, 그중 30건이 관광지다:
   *
   *   전주수목원 무궁화화원1 · 남부수종원 · 일반수목원 · 로드덴드론 가든 · 교육홍보관
   *     → 다섯 개가 전부 모시설 '전주수목원' 의 20회를 나눠 가짐 (전주 케이스 10/16)
   *   한옥마을 선비문화관 · 한옥마을 예술공동체 → '한옥마을' 170회
   *   광주광역시 서구문화원 · 부산광역시 119안전체험관 → 행정구역명 언급
   *
   * 앞머리만 빼면 폴백의 원래 목적은 그대로다 — '서문시장' 은 앞머리가 아니라 살아남는다.
   */
  private dropLeadingQualifier(name: string, tokens: string[]): string[] {
    if (!leadingQualifierDropEnabled()) return tokens;
    // 장식 구분자(&·,·괄호)가 있는 등록명은 **앞머리가 곧 정체성**이라 예외다 —
    // '롯데월드타워&롯데월드몰' 의 앞머리를 막으면 정답 '롯데월드타워' 를 통째로 잃는다.
    // 공백만으로 이어진 이름에서만 앞머리를 담는 것(행정구역·모시설)으로 본다.
    if (NaverPopularityIndex.DECORATIVE_SPLIT.test(name)) return tokens;
    return tokens.slice(1);
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
    return Math.min(1, MENTION_SCORE_BASE + this.logSlope * Math.log2(mentions + 1));
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
