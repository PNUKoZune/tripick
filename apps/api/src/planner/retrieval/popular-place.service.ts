import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KakaoLocalService } from './kakao-local.service';
import { NaverSearchService } from './naver-search.service';
import { extractPlaceNameCandidates, isGenericPlaceName } from './popular-name-extract';
import { parseSigungu, regionSearchStem } from './place-seeds';
import { placeRegionCodes, toSidoCode } from './region-code';
import type { MentionCorpus } from './naver-search.service';
import type { PlaceNameCandidate } from './popular-name-extract';
import type { IngestPlace } from './ingestion.types';
import type { RawPlaceCandidate } from './types';

/**
 * 네이버 추천 글에서 이름이 자주 오르는 장소를 카카오로 정규화해 적재 후보로 만드는 소스.
 *
 * 왜 별도 소스인가 — KTO `areaBasedList2` 는 인기순 정렬이 없어 페이지를 깊게 파도
 * 남산서울타워·설악산·성산일출봉 같은 대표 명소가 안 잡혔다(골든셋 커버리지 47%).
 * 카카오 카테고리 검색(`searchAround`)도 좌표 앵커 주변을 정확도순으로 훑을 뿐
 * "남들이 실제로 많이 가는 곳"이라는 신호가 없다. 그 신호는 네이버 추천 글에만 있다.
 *
 * 파이프라인: 네이버 코퍼스 → 이름 추출(제안) → 카카오 정규화 → 역방향 확인 → IngestPlace.
 * 세 번째·네 번째 단계가 정확성을 책임진다 — 자세한 근거는 popular-name-extract.ts 주석 참고.
 */

/** 이 소스가 노리는 두 축. 축마다 코퍼스와 인정 카테고리를 따로 둔다. */
interface PopularAxis {
  label: string;
  /** `{지역 어간} {suffix}` 로 결합해 네이버 코퍼스를 만든다. */
  suffixes: readonly string[];
  /** 카카오가 준 category 라벨 중 이 축으로 인정할 것 */
  categories: readonly string[];
  /** 지역 예산 중 이 축의 몫 */
  share: number;
}

/**
 * 축을 갈라 코퍼스를 따로 모으는 이유 — 명소 이름은 추천 글 300건에서 수십 번씩 나오고
 * 맛집 이름은 한 자리 수다. 한 코퍼스에 섞어 빈도순으로 자르면 상위가 전부 명소로 차서
 * 맛집이 통째로 안 들어온다. 축별 예산(share)도 그래서 필요하다.
 */
const AXES: readonly PopularAxis[] = [
  {
    label: '명소',
    suffixes: ['여행지 추천', '가볼만한 곳', '명소'],
    categories: ['attraction'],
    share: 0.6,
  },
  {
    label: '맛집',
    suffixes: ['맛집 추천', '맛집 베스트', '카페 추천'],
    categories: ['restaurant', 'cafe'],
    share: 0.4,
  },
];

/** 코퍼스는 크게 모아야 대표 장소의 빈도 신호가 또렷해진다 (네이버 상한 100). */
const CORPUS_DISPLAY = 100;
/** 후보 1건당 카카오 문서 몇 개까지 보고 축·지역에 맞는 걸 고를지. */
const RESOLVE_DOCS = 5;

/** 카카오 문서 1건에 대한 판정. */
type Verdict = 'ok' | 'category' | 'region' | 'unmentioned' | 'generic' | 'duplicate';

/** 후보가 왜 탈락했는지 — 조용한 스킵을 남기지 않기 위한 계수. */
interface RejectCounts extends Record<Exclude<Verdict, 'ok'>, number> {
  /** 카카오가 아무 문서도 못 줌 (추출한 이름이 실재하지 않음) */
  no_match: number;
  /** 축과 다른 카테고리만 나옴 */
  category: number;
  /** 다른 시도의 동명 장소만 나옴 */
  region: number;
  /** 정본명이 코퍼스에 없음 — 관문 ②. '여행'→'경주여행사' 류가 여기서 죽는다 */
  unmentioned: number;
  /** 정본명이 상호가 아니라 검색 노출용 문구('서울맛집'·'놀만한곳') */
  generic: number;
  /** 이미 수집한 장소 */
  duplicate: number;
}

@Injectable()
export class PopularPlaceService {
  private readonly logger = new Logger(PopularPlaceService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly naverSearch: NaverSearchService,
    private readonly kakaoLocal: KakaoLocalService,
  ) {}

  /** 네이버 검색 키가 없으면 이 소스는 아무것도 못 한다. 호출 측이 앞에서 막게 노출한다. */
  get isAvailable(): boolean {
    return this.naverSearch.hasCredentials();
  }

  /**
   * 한 지역의 대표 명소·맛집을 budget 건까지 수집한다.
   * 어느 축이든 실패하면(코퍼스 비었음 등) 그 축만 건너뛰고 나머지는 계속한다.
   */
  async collect(region: string, budget: number): Promise<IngestPlace[]> {
    const stem = regionSearchStem(region) || region;
    // KTO 라벨('경상북도')과 주소('경상북도 경주시 …')가 같은 코드로 떨어지는지로 지역을 검증한다.
    const targetSido = toSidoCode(region) ?? (await this.resolveParentSido(region, stem));
    if (!targetSido) {
      this.logger.warn(
        `[${region}] 시도 코드로 해석되지 않는 라벨 — 지역 검증 없이 수집합니다(타지역 동명 장소가 섞일 수 있음).`,
      );
    }

    const collected: IngestPlace[] = [];
    const seenPlaceIds = new Set<string>();

    for (const axis of AXES) {
      const axisBudget = Math.max(1, Math.round(budget * axis.share));
      const queries = axis.suffixes.map((suffix) => `${stem} ${suffix}`);
      const corpus = await this.naverSearch.collectMentionCorpus(queries, CORPUS_DISPLAY);
      if (!corpus) {
        this.logger.warn(`[${region}] ${axis.label} 코퍼스를 모으지 못해 이 축을 건너뜁니다.`);
        continue;
      }

      const candidates = extractPlaceNameCandidates(corpus.text, {
        limit: Math.ceil(axisBudget * this.candidateMultiplier()),
        excludeTokens: this.regionTokens(region, stem),
      });

      const before = collected.length;
      const rejects = await this.resolveCandidates(
        candidates,
        { region, stem, targetSido, axis, corpus, axisBudget },
        collected,
        seenPlaceIds,
      );

      this.logger.log(
        `[${region}] ${axis.label}: 코퍼스 ${corpus.docCount}건 → 후보 ${candidates.length} → 확정 ${collected.length - before} ` +
          `(탈락 미발견 ${rejects.no_match} / 카테고리 ${rejects.category} / 타지역 ${rejects.region} / ` +
          `언급없음 ${rejects.unmentioned} / 상투어 ${rejects.generic} / 중복 ${rejects.duplicate})`,
      );
    }

    return collected;
  }

  /**
   * 시군구 단위 타깃('속초')의 상위 시도를 카카오 1회 조회로 알아낸다.
   *
   * 검증을 **시군구가 아니라 시도로** 하는 이유 — '속초 여행' 글은 양양의 설악산을 함께 다룬다.
   * 시군구 정확 일치로 걸러 버리면 그 지역 여행에서 실제로 가는 인접 명소가 통째로 빠진다.
   * 반대로 검증을 아예 빼면 타지역 동명 장소가 섞이므로 시도 수준이 적당한 타협점이다.
   */
  private async resolveParentSido(region: string, stem: string): Promise<string | null> {
    const docs = await this.kakaoLocal.searchByText(stem, 1);
    const address = docs[0]?.address;
    if (!address) return null;
    const { regionCode } = placeRegionCodes(null, null, address);
    if (regionCode) {
      this.logger.log(`[${region}] 시군구 단위 타깃 — 상위 시도 '${regionCode}' 기준으로 검증합니다.`);
    }
    return regionCode;
  }

  /**
   * 후보를 하나씩 카카오로 정규화하며 축 예산이 찰 때까지 채운다.
   * 예산이 차면 남은 후보는 조회하지 않는다(카카오 호출 절약).
   */
  private async resolveCandidates(
    candidates: PlaceNameCandidate[],
    ctx: {
      region: string;
      stem: string;
      targetSido: string | null;
      axis: PopularAxis;
      corpus: MentionCorpus;
      axisBudget: number;
    },
    collected: IngestPlace[],
    seenPlaceIds: Set<string>,
  ): Promise<RejectCounts> {
    const rejects: RejectCounts = {
      no_match: 0,
      category: 0,
      region: 0,
      unmentioned: 0,
      generic: 0,
      duplicate: 0,
    };
    let accepted = 0;

    for (const candidate of candidates) {
      if (accepted >= ctx.axisBudget) break;

      const docs = await this.kakaoLocal.searchByText(
        `${ctx.stem} ${candidate.name}`,
        RESOLVE_DOCS,
      );
      if (docs.length === 0) {
        rejects.no_match += 1;
        continue;
      }

      for (const doc of docs) {
        const verdict = this.verify(doc, ctx, seenPlaceIds);
        if (verdict !== 'ok') {
          rejects[verdict] += 1;
          continue;
        }
        if (doc.kakaoPlaceId) seenPlaceIds.add(doc.kakaoPlaceId);
        collected.push(this.toIngestPlace(doc, ctx.region));
        accepted += 1;
        break;
      }
    }

    return rejects;
  }

  /** 카카오 문서가 이 축·지역의 실제 인기 장소인지 판정한다. */
  private verify(
    doc: RawPlaceCandidate,
    ctx: { region: string; targetSido: string | null; axis: PopularAxis; corpus: MentionCorpus },
    seenPlaceIds: ReadonlySet<string>,
  ): Verdict {
    if (!ctx.axis.categories.includes(doc.category)) return 'category';
    if (isGenericPlaceName(doc.name)) return 'generic';

    // 주소가 정본 — 카카오 키워드 검색은 지역 접두어를 붙여도 타지역 동명 장소를 섞어 준다.
    const { regionCode } = placeRegionCodes(ctx.region, null, doc.address);
    if (ctx.targetSido && regionCode !== ctx.targetSido) return 'region';

    // 관문 ②: 카카오가 준 정본명이 코퍼스에 실제로 있어야 한다.
    if (ctx.corpus.index.mentions(doc.name) === 0) return 'unmentioned';

    if (doc.kakaoPlaceId && seenPlaceIds.has(doc.kakaoPlaceId)) return 'duplicate';
    return 'ok';
  }

  private toIngestPlace(doc: RawPlaceCandidate, region: string): IngestPlace {
    const sigungu = parseSigungu(doc.address);
    return {
      ...(doc.kakaoPlaceId ? { kakaoPlaceId: doc.kakaoPlaceId } : {}),
      name: doc.name,
      category: doc.category,
      ...(doc.categoryDetail ? { categoryDetail: doc.categoryDetail } : {}),
      address: doc.address,
      coordinates: doc.coordinates,
      region,
      ...(sigungu ? { sigungu } : {}),
      source: 'popular',
    };
  }

  /**
   * 후보에서 뺄 지역 토큰. '경주 경주박물관' 은 되지만 후보 자체가 '경주'면 무의미한 조회가 된다.
   */
  private regionTokens(region: string, stem: string): string[] {
    return [region, stem, ...stem.split(/\s+/)].filter(Boolean);
  }

  /**
   * 축 예산의 몇 배수까지 후보를 뽑아 볼지. 관문에서 상당수가 탈락하므로 과다 추출이 필요하다.
   *
   * 기본 5 는 실측으로 정했다 — 배수 3(=후보 108)에서 '설악산'(129위)·'서문시장'(109위)이
   * 상한 바로 밖에 걸려 탈락했다. 세 관문을 전부 통과하는 이름이 100위권에 있다는 뜻이라
   * 깊이가 모자랐던 것이다. 올려도 적재 품질은 관문이 지키므로 늘어나는 건 카카오 호출뿐이다.
   */
  private candidateMultiplier(): number {
    const value = Number(this.config.get<string | number>('POPULAR_INGEST_CANDIDATE_MULTIPLIER', 5));
    return Number.isFinite(value) && value >= 1 ? value : 5;
  }
}
