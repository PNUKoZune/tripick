/**
 * 검색(CRAG 리트리벌) 품질 평가 하네스.
 *
 * 왜 — blend weight·반경·confidence 임계 같은 랭킹 상수가 전부 감으로 잡혀 있고,
 * 바꿨을 때 좋아졌는지 나빠졌는지 볼 방법이 없었다. 고정 골든셋에 대해 recall@k·MRR 을
 * 재서 회귀 기준선을 만들고, 파라미터 스윕으로 튜닝 근거를 남긴다.
 * (LLM 하네스가 일정 생성 쪽에서 하는 일을 검색 쪽에서 하는 것)
 *
 * 실행:
 *   cd apps/api
 *   pnpm eval:retrieval                              # 현재 설정으로 기준선 측정
 *   pnpm eval:retrieval -- --case=gyeongju-cultural  # 특정 케이스만
 *   pnpm eval:retrieval -- --sweep=PREFERENCE_BLEND_WEIGHT=0,0.3,0.6,1
 *   pnpm eval:retrieval -- --sweep=KAKAO_SEARCH_RADIUS_M=5000,10000,20000
 *   pnpm eval:retrieval -- --json=eval.json          # 결과 덤프(전후 diff 용)
 *
 * 옵션:
 *   --set=<path>        골든셋 파일 (기본 retrieval-golden-set.json)
 *   --case=a,b          케이스 id 필터
 *   --k=5,10            recall@k 의 k 목록 (기본 5,10)
 *   --limit=16          케이스별 검색 결과 수 (골든셋 값 우선)
 *   --sweep=KEY=v1,v2   환경변수 값을 바꿔가며 반복 측정 (여러 번 지정하면 조합)
 *   --no-preference     취향 벡터 개인화 없이 측정 (blend weight 영향 제거)
 *   --json=<path>       상세 결과 JSON 덤프
 *
 * 주의: 실제 파이프라인을 그대로 태운다 — pgvector·카카오·네이버 인지도까지 호출한다.
 * 즉 외부 API 키가 없으면 그 신호만 빠진 상태의 점수가 나온다(비교 자체는 유효).
 *
 * ## ⚠️ 전후 비교는 **한 프로세스 안에서** 해야 한다
 *
 * 인지도 코퍼스가 네이버 실시간 검색이라 **시간이 지나면 바뀐다.** 캐시는 프로세스 안에만
 * 살아 있어 실행마다 새로 받는다. 그래서:
 *
 *   - 몇 분 안에 반복 실행 → **완전히 동일**(실측 3회 연속 소수점까지 일치)
 *   - 30분쯤 지난 뒤 실행 → R@10 이 0.356~0.369 로 흔들린다(폭 0.013)
 *
 * 이 변동폭이 웬만한 튜닝 효과보다 크다. 실제로 태그 사전 확장을 시점이 다른 두 실행으로
 * 비교했을 때 "R@10 +0.006, 제주 MRR 0.50→1.00, 속초 R@10 +0.10" 이 나왔는데, 같은 코드로
 * 연속 A/B 하니 **소수점까지 완전히 동일**했다 — 전부 코퍼스 변동이었다.
 *
 * 그래서 파라미터 비교는 `--sweep` 을 쓴다(한 프로세스에서 코퍼스를 공유한다). 코드 변경은
 * 노브로 뺄 수 있으면 노브 스윕으로, 아니면 **몇 분 안에 연속으로** 돌려 비교할 것.
 */
import 'reflect-metadata';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { ReplanTrigger, TasteTagDto } from '@tripick/types';
import { CragEvaluatorService } from '../planner/retrieval/crag-evaluator.service';
import { DestinationAnchorService } from '../planner/retrieval/destination-anchor.service';
import { KakaoLocalService } from '../planner/retrieval/kakao-local.service';
import { NaverSearchService } from '../planner/retrieval/naver-search.service';
import { PlaceEmbeddingRepository } from '../planner/retrieval/place-embedding.repository';
import { PlaceRetrievalService } from '../planner/retrieval/place-retrieval.service';
import { TextEmbeddingService } from '../../src/embedding/text-embedding.service';
import { buildPreferenceText } from '../preferences/preference-text';
import {
  destinationRegionFilter,
  placeRegionCodes,
  toSigunguCode,
} from '../planner/retrieval/region-code';
import { isClosedAt } from '../planner/retrieval/opening-hours.parser';
import type { CandidatePlace } from '../planner/retrieval/types';

/**
 * 골든셋의 정답 장소가 place_embeddings 에 **적재돼 있기는 한지** 확인한다.
 * 랭킹 실패(적재됐는데 상위에 못 옴)와 커버리지 실패(애초에 없음)를 갈라 보기 위한 것 —
 * 안 그러면 적재를 안 돌린 지역의 낮은 recall 을 랭킹 탓으로 오독하게 된다.
 */
class CatalogProbe {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly anchors: DestinationAnchorService,
  ) {}

  async exists(name: string, destination: string): Promise<boolean> {
    // 앵커 목적지('광안리')는 destinationRegionFilter 가 실재하지 않는 코드를 만들어 내
    // 존재 확인이 통째로 0 건이 된다(실측: 앵커 케이스 catalog 0%). 검색과 같은 해석을 쓴다.
    const anchor = await this.anchors.resolve(destination);
    const { sido, sigungu } = anchor?.region ?? destinationRegionFilter(destination);
    const code = sido ?? sigungu;
    const rows: Array<{ hit: string }> = await this.dataSource.query(
      `SELECT '1' AS hit FROM place_embeddings
       WHERE replace(name, ' ', '') ILIKE '%' || $1 || '%'
         AND ($2::text IS NULL OR region_code = $2 OR sigungu_code = $2)
       LIMIT 1`,
      [name.replace(/\s+/g, ''), code],
    );
    return rows.length > 0;
  }
}

/** 평가 CLI 전용 경량 모듈 (AppModule 의 BullMQ·WebSocket 없이 검색 경로만). */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url:
          config.get<string>('DATABASE_URL') ??
          'postgresql://tripick:tripick@localhost:5432/tripick',
        autoLoadEntities: true,
        synchronize: false,
        logging: false,
      }),
    }),
  ],
  providers: [
    TextEmbeddingService,
    PlaceEmbeddingRepository,
    KakaoLocalService,
    NaverSearchService,
    CragEvaluatorService,
    DestinationAnchorService,
    PlaceRetrievalService,
    CatalogProbe,
  ],
})
class RetrievalEvalModule {}

interface GoldenCase {
  id: string;
  intent?: string;
  destination: string;
  expectRegion?: string;
  trigger?: ReplanTrigger;
  notes?: string;
  limit?: number;
  tasteTags?: TasteTagDto;
  relevant: string[];
  forbidden?: string[];
  /**
   * 현재 위치. 카카오 폴백이 좌표 앵커(center+radius) 검색을 타게 하고 CRAG 거리 점수를 켠다.
   * 이게 없으면 폴백은 키워드 전역 검색이라 **다른 지역 후보가 섞이는 경로**를 지난다.
   */
  currentLocation?: { lat: number; lng: number };
  /**
   * 방문 시각(ISO). 영업시간 가드(`availability`)는 이 값이 있을 때만 판정한다 —
   * 없으면 전 후보 중립값이라 그 항의 변경을 지표가 감지할 수 없다.
   */
  startAt?: string;
}

interface CaseMetrics {
  id: string;
  destination: string;
  retrieved: number;
  /** k → recall@k (정답 중 상위 k 안에 든 비율) */
  recall: Record<number, number>;
  /** 적재된 정답만으로 다시 계산한 recall@maxK — 랭킹 자체의 성적 */
  recallInCatalog: number;
  /** 정답 중 카탈로그에 실제로 있는 비율 (적재 커버리지) */
  catalog: number;
  /** 첫 정답의 역순위 */
  mrr: number;
  /** 결과 중 목적지 지역과 맞는 비율 */
  regionPrecision: number;
  /** 나오면 안 되는 장소가 결과에 든 수 */
  forbiddenHits: number;
  /**
   * 결과 중 방문 시각에 **영업시간 밖**인 장소 수 (`startAt` 없는 케이스는 항상 0).
   * `availability` 감점이 실제로 후보를 밀어내는지 보는 지표 — 이게 없으면 그 항을 지워도
   * 골든셋이 "무해" 라고 보고한다.
   */
  closedHits: number;
  /**
   * 영업시간 밖 장소 중 **가장 높은 순위**(1-based, 없으면 0).
   *
   * 개수만으로는 감점을 못 잡는다 — 실측에서 순창 `강천사계곡` 은 감점 0.037 로 3위→5위로
   * 밀리지만 8칸 안에는 그대로 남아 `closedHits` 가 1 로 동일했다. 순위까지 봐야 그 항의
   * 변경이 지표에 나타난다.
   */
  firstClosedRank: number;
  averageConfidence: number;
  sources: string[];
  fallbackUsed: boolean;
  hits: string[];
  misses: string[];
  /**
   * 상위 결과의 이름·카테고리·CRAG 항목 점수. 놓친 정답 대신 **무엇이 올라왔는지** 보려면
   * 이게 있어야 한다 — 항목별 점수까지 봐야 어느 항이 순위를 밀어올렸는지 갈린다.
   * JSON 덤프에만 담기고 표 출력에는 영향이 없다.
   */
  top: Array<{
    name: string;
    /** 지역 누수를 판정하는 근거. 이게 없으면 `inRegion` 이 틀렸을 때 원인을 못 찾는다. */
    address: string;
    source: string;
    category: string;
    confidence: number;
    inRegion: boolean;
    isRelevant: boolean;
    terms: Record<string, number>;
  }>;
  /** 적재돼 있는데 상위에 못 든 정답 — 랭킹이 실패한 대상 */
  missesInCatalog: string[];
}

function parseArgs(argv: string[]) {
  const options = {
    setPath: resolve(__dirname, 'retrieval-golden-set.json'),
    caseIds: [] as string[],
    ks: [5, 10],
    limit: undefined as number | undefined,
    sweeps: [] as Array<{ key: string; values: string[] }>,
    usePreference: true,
    jsonPath: undefined as string | undefined,
  };
  for (const arg of argv) {
    const [rawKey, ...rest] = arg.replace(/^--/, '').split('=');
    const value = rest.join('=').trim();
    if (rawKey === 'no-preference') options.usePreference = false;
    else if (rawKey === 'set' && value) options.setPath = resolve(process.cwd(), value);
    else if (rawKey === 'case' && value) options.caseIds = value.split(',').map((s) => s.trim());
    else if (rawKey === 'k' && value) options.ks = value.split(',').map(Number).filter((n) => n > 0);
    else if (rawKey === 'limit' && value) options.limit = Number(value);
    else if (rawKey === 'json' && value) options.jsonPath = resolve(process.cwd(), value);
    else if (rawKey === 'sweep' && value) {
      const [key, list] = value.split('=');
      if (key && list) options.sweeps.push({ key, values: list.split(',').map((s) => s.trim()) });
    }
  }
  return options;
}

/**
 * 공백·대소문자를 무시한 부분일치. '동궁과 월지' ↔ '동궁과월지(안압지)' 처럼 표기가 흔들려서.
 *
 * **짧은 쪽이 3글자 이상이어야 한다** — 양방향 부분일치라 2글자 결과가 그걸 품은 정답의
 * 크레딧을 훔친다. 실측에서 대구 식당 '다시' 가 정답 '김광석다시그리기길' 로 인정돼
 * 그 케이스 MRR 이 1.00 으로 잡혔다(1위가 정답이라는 뜻인데 실제로는 무관한 식당).
 * 지표를 부풀리는 방향의 오탐이라 반드시 막아야 한다.
 */
const MIN_NAME_MATCH_LENGTH = 3;

/**
 * 정답 이름을 품고 있어도 **그 장소가 아닌** 부속 시설. 정답 쪽에 같은 토큰이 없으면 매칭에서 뺀다.
 *
 * 왜 필요한가 — 포함 매칭이 양방향이라 '남부시장 천변유료주차장'이 정답 '남부시장'의 hit 로,
 * '무섬마을 임시주차장'이 '무섬마을'의 hit 로 세어지고 있었다(실측 2건). 주차장을 찾아 준 걸
 * 정답으로 세면 recall 이 부풀고, 그 위에서 랭킹을 튜닝하면 노이즈를 쫓게 된다.
 *
 * 브랜드 지점('테라로사 사천해변점')은 빼지 않는다 — 강릉 케이스의 정답 '테라로사'는 브랜드이고
 * 그 지점이 실제로 방문할 장소다. 부속 시설과 지점은 다른 문제라 같은 규칙으로 묶으면 안 된다.
 */
const ANCILLARY_TOKENS = ['주차장', '매표소', '안내소', '정류장', '화장실'] as const;

function nameMatches(candidate: string, expected: string): boolean {
  const a = candidate.replace(/\s+/g, '').toLowerCase();
  const b = expected.replace(/\s+/g, '').toLowerCase();
  if (a === b) return true;
  if (ANCILLARY_TOKENS.some((token) => a.includes(token) && !b.includes(token))) return false;
  // 2자 이름('우도'·'홍대')은 완전 일치로만 잡는다. 부분 매칭을 허용하면 우연한 포함이 흔하다.
  const shorter = a.length <= b.length ? a : b;
  if (shorter.length < MIN_NAME_MATCH_LENGTH) return false;
  return a.includes(b) || b.includes(a);
}

function firstRelevantRank(places: CandidatePlace[], relevant: string[]): number {
  for (let i = 0; i < places.length; i += 1) {
    if (relevant.some((name) => nameMatches(places[i]!.name, name))) return i + 1;
  }
  return 0;
}

/**
 * 결과 장소가 목적지 지역에 속하는지 — 주소에서 파생한 시도·시군구 코드로 본다.
 * 적재와 **같은 함수**(`placeRegionCodes`)를 써야 한다. 통합 라벨('전남광주통합특별시')은
 * 시도 토큰만으로 안 갈려서, 예전처럼 `toSidoCode` 로 첫 토큰만 보면 광주 장소가 전부
 * '전남' 으로 읽혀 지역정합이 0% 로 오보고된다.
 */
function inExpectedRegion(place: CandidatePlace, expected: string): boolean {
  const { regionCode, sigunguCode } = placeRegionCodes(null, null, place.address ?? null);
  return regionCode === expected || sigunguCode === expected;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

async function evaluateCase(
  testCase: GoldenCase,
  deps: {
    retrieval: PlaceRetrievalService;
    embeddings: TextEmbeddingService;
    catalog: CatalogProbe;
  },
  options: ReturnType<typeof parseArgs>,
): Promise<CaseMetrics> {
  const limit = options.limit ?? testCase.limit ?? 16;

  // 저장된 취향 임베딩과 같은 방식으로(취향 텍스트 → 임베딩) 개인화 벡터를 만든다.
  const preferenceVector =
    options.usePreference && testCase.tasteTags
      ? await deps.embeddings.embed(buildPreferenceText(testCase.tasteTags))
      : undefined;

  const startAt = testCase.startAt ? new Date(testCase.startAt) : undefined;
  const result = await deps.retrieval.retrieve({
    userId: 'eval-harness',
    destination: testCase.destination,
    limit,
    ...(testCase.tasteTags ? { tasteTags: testCase.tasteTags } : {}),
    ...(testCase.trigger ? { trigger: testCase.trigger } : {}),
    ...(testCase.notes ? { notes: testCase.notes } : {}),
    ...(preferenceVector ? { preferenceVector } : {}),
    ...(testCase.currentLocation ? { currentLocation: testCase.currentLocation } : {}),
    ...(startAt ? { startAt } : {}),
  });

  const places = result.places;
  const maxK = Math.max(...options.ks, places.length);
  const recall: Record<number, number> = {};
  for (const k of options.ks) {
    const top = places.slice(0, k);
    const found = testCase.relevant.filter((name) =>
      top.some((place) => nameMatches(place.name, name)),
    );
    recall[k] = testCase.relevant.length === 0 ? 0 : found.length / testCase.relevant.length;
  }

  const hits = testCase.relevant.filter((name) =>
    places.slice(0, maxK).some((place) => nameMatches(place.name, name)),
  );
  const misses = testCase.relevant.filter((name) => !hits.includes(name));

  const inCatalog: string[] = [];
  for (const name of testCase.relevant) {
    if (await deps.catalog.exists(name, testCase.destination)) inCatalog.push(name);
  }

  const rank = firstRelevantRank(places, testCase.relevant);
  const expectedRegion = testCase.expectRegion;

  return {
    id: testCase.id,
    destination: testCase.destination,
    retrieved: places.length,
    recall,
    recallInCatalog:
      inCatalog.length === 0 ? 0 : hits.filter((name) => inCatalog.includes(name)).length / inCatalog.length,
    catalog: testCase.relevant.length === 0 ? 0 : inCatalog.length / testCase.relevant.length,
    mrr: rank === 0 ? 0 : 1 / rank,
    regionPrecision:
      !expectedRegion || places.length === 0
        ? 0
        : places.filter((place) => inExpectedRegion(place, expectedRegion)).length / places.length,
    forbiddenHits: (testCase.forbidden ?? []).filter((name) =>
      places.some((place) => nameMatches(place.name, name)),
    ).length,
    closedHits: startAt
      ? places.filter((place) => isClosedAt(place.openingHours, startAt)).length
      : 0,
    firstClosedRank: startAt
      ? places.findIndex((place) => isClosedAt(place.openingHours, startAt)) + 1
      : 0,
    averageConfidence: result.trace.averageConfidence,
    sources: result.trace.sources,
    fallbackUsed: result.trace.fallbackUsed,
    hits,
    misses,
    missesInCatalog: misses.filter((name) => inCatalog.includes(name)),
    top: places.map((place) => ({
      name: place.name,
      address: place.address ?? '',
      source: place.source,
      category: place.category,
      confidence: place.confidence,
      inRegion: !expectedRegion ? true : inExpectedRegion(place, expectedRegion),
      isRelevant: testCase.relevant.some((name) => nameMatches(place.name, name)),
      terms: {
        retrieval: round3(place.crag.retrieval),
        taste: round3(place.crag.taste),
        popularity: round3(place.crag.popularity),
        locality: round3(place.crag.locality),
        context: round3(place.crag.context),
        availability: round3(place.crag.availability),
        ...(place.crag.personalization !== undefined
          ? { personalization: round3(place.crag.personalization) }
          : {}),
      },
    })),
  };
}

function round3(value: number): number {
  return Number(value.toFixed(3));
}

function printTable(metrics: CaseMetrics[], ks: number[]): void {
  const header = [
    'case'.padEnd(26),
    'n'.padStart(3),
    ...ks.map((k) => `R@${k}`.padStart(6)),
    'R|cat'.padStart(6),
    'cat'.padStart(5),
    'MRR'.padStart(5),
    'region'.padStart(7),
    'forb'.padStart(5),
    'clsd'.padStart(7),
    'conf'.padStart(5),
    ' source',
  ].join(' ');
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const m of metrics) {
    console.log(
      [
        m.id.padEnd(26),
        String(m.retrieved).padStart(3),
        ...ks.map((k) => (m.recall[k] ?? 0).toFixed(2).padStart(6)),
        m.recallInCatalog.toFixed(2).padStart(6),
        pct(m.catalog).padStart(5),
        m.mrr.toFixed(2).padStart(5),
        pct(m.regionPrecision).padStart(7),
        String(m.forbiddenHits).padStart(5),
        (m.closedHits === 0 ? '0' : `${m.closedHits}@${m.firstClosedRank}`).padStart(7),
        m.averageConfidence.toFixed(2).padStart(5),
        ` ${m.sources.join('+') || 'none'}`,
      ].join(' '),
    );
  }
}

function aggregate(metrics: CaseMetrics[], ks: number[]) {
  return {
    cases: metrics.length,
    recall: Object.fromEntries(ks.map((k) => [k, mean(metrics.map((m) => m.recall[k] ?? 0))])),
    recallInCatalog: mean(metrics.map((m) => m.recallInCatalog)),
    catalog: mean(metrics.map((m) => m.catalog)),
    mrr: mean(metrics.map((m) => m.mrr)),
    regionPrecision: mean(metrics.map((m) => m.regionPrecision)),
    forbiddenHits: metrics.reduce((sum, m) => sum + m.forbiddenHits, 0),
    closedHits: metrics.reduce((sum, m) => sum + m.closedHits, 0),
    // 여러 케이스를 섞으면 최상위 순위가 가장 나쁜(작은) 쪽이 대표값이다.
    worstClosedRank: Math.min(
      ...metrics.filter((m) => m.firstClosedRank > 0).map((m) => m.firstClosedRank),
      Number.POSITIVE_INFINITY,
    ),
    averageConfidence: mean(metrics.map((m) => m.averageConfidence)),
    pgvectorOnly: metrics.filter((m) => !m.fallbackUsed).length,
  };
}

function printAggregate(agg: ReturnType<typeof aggregate>, ks: number[]): void {
  console.log(
    `평균 ${ks.map((k) => `recall@${k} ${agg.recall[k]!.toFixed(3)}`).join(' | ')} | ` +
      `카탈로그내 recall ${agg.recallInCatalog.toFixed(3)} | 적재 커버리지 ${pct(agg.catalog)} | ` +
      `MRR ${agg.mrr.toFixed(3)} | 지역정합 ${pct(agg.regionPrecision)} | ` +
      `금지어 ${agg.forbiddenHits} | 영업시간밖 ${agg.closedHits}${Number.isFinite(agg.worstClosedRank) ? `(최상위 ${agg.worstClosedRank}위)` : ''} | conf ${agg.averageConfidence.toFixed(3)} | ` +
      `pgvector 단독 ${agg.pgvectorOnly}/${agg.cases}`,
  );
}

/** --sweep 조합(데카르트 곱)을 만든다. 스윕이 없으면 현재 설정 1회. */
function sweepCombinations(
  sweeps: Array<{ key: string; values: string[] }>,
): Array<Record<string, string>> {
  return sweeps.reduce<Array<Record<string, string>>>(
    (acc, { key, values }) =>
      acc.flatMap((combo) => values.map((value) => ({ ...combo, [key]: value }))),
    [{}],
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const goldenSet = JSON.parse(readFileSync(options.setPath, 'utf8')) as { cases: GoldenCase[] };
  const cases = options.caseIds.length
    ? goldenSet.cases.filter((c) => options.caseIds.includes(c.id))
    : goldenSet.cases;

  if (cases.length === 0) {
    console.error('평가할 케이스가 없습니다. --case 필터를 확인하세요.');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(RetrievalEvalModule, {
    logger: ['warn', 'error'],
  });

  try {
    const deps = {
      retrieval: app.get(PlaceRetrievalService),
      embeddings: app.get(TextEmbeddingService),
      catalog: app.get(CatalogProbe),
    };

    const combos = sweepCombinations(options.sweeps);
    const runs: Array<{ params: Record<string, string>; metrics: CaseMetrics[] }> = [];

    for (const combo of combos) {
      // ConfigService 는 process.env 를 실시간으로 읽으므로 여기서 덮으면 그대로 반영된다.
      for (const [key, value] of Object.entries(combo)) process.env[key] = value;
      // 인지도 인덱스는 목적지 단위 캐시라, 비우지 않으면 첫 조합의 인덱스를 뒤 조합이
      // 재사용해 스윕이 조용히 무효가 된다(코퍼스 크기 스윕이 실제로 그렇게 무효였다).
      app.get(NaverSearchService).clearCache();

      const label = Object.entries(combo)
        .map(([key, value]) => `${key}=${value}`)
        .join(' ');
      console.log(`\n=== 검색 품질 평가${label ? ` (${label})` : ''} — 케이스 ${cases.length}개 ===`);

      const metrics: CaseMetrics[] = [];
      for (const testCase of cases) {
        metrics.push(await evaluateCase(testCase, deps, options));
      }
      printTable(metrics, options.ks);
      console.log('-'.repeat(20));
      printAggregate(aggregate(metrics, options.ks), options.ks);
      runs.push({ params: combo, metrics });
    }

    if (combos.length > 1) {
      console.log('\n=== 스윕 요약 ===');
      for (const run of runs) {
        const agg = aggregate(run.metrics, options.ks);
        const label = Object.entries(run.params)
          .map(([key, value]) => `${key}=${value}`)
          .join(' ');
        console.log(
          `${label.padEnd(40)} ${options.ks
            .map((k) => `R@${k} ${agg.recall[k]!.toFixed(3)}`)
            .join(' ')} | R|cat ${agg.recallInCatalog.toFixed(3)} | MRR ${agg.mrr.toFixed(3)} | 지역 ${pct(agg.regionPrecision)}`,
        );
      }
    }

    if (options.jsonPath) {
      writeFileSync(
        options.jsonPath,
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            set: options.setPath,
            ks: options.ks,
            runs: runs.map((run) => ({
              params: run.params,
              aggregate: aggregate(run.metrics, options.ks),
              cases: run.metrics,
            })),
          },
          null,
          2,
        ),
      );
      console.log(`\nJSON 덤프: ${options.jsonPath}`);
    }
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('평가 실패:', err);
    process.exit(1);
  });
