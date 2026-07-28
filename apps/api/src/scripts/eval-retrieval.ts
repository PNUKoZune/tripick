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
import { KakaoLocalService } from '../planner/retrieval/kakao-local.service';
import { NaverSearchService } from '../planner/retrieval/naver-search.service';
import { PlaceEmbeddingRepository } from '../planner/retrieval/place-embedding.repository';
import { PlaceRetrievalService } from '../planner/retrieval/place-retrieval.service';
import { TextEmbeddingService } from '../../src/embedding/text-embedding.service';
import { buildPreferenceText } from '../preferences/preference-text';
import { destinationRegionFilter, toSidoCode, toSigunguCode } from '../planner/retrieval/region-code';
import type { CandidatePlace } from '../planner/retrieval/types';

/**
 * 골든셋의 정답 장소가 place_embeddings 에 **적재돼 있기는 한지** 확인한다.
 * 랭킹 실패(적재됐는데 상위에 못 옴)와 커버리지 실패(애초에 없음)를 갈라 보기 위한 것 —
 * 안 그러면 적재를 안 돌린 지역의 낮은 recall 을 랭킹 탓으로 오독하게 된다.
 */
class CatalogProbe {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async exists(name: string, destination: string): Promise<boolean> {
    const { sido, sigungu } = destinationRegionFilter(destination);
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
  averageConfidence: number;
  sources: string[];
  fallbackUsed: boolean;
  hits: string[];
  misses: string[];
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

/** 공백·대소문자를 무시한 부분일치. '동궁과 월지' ↔ '동궁과월지(안압지)' 처럼 표기가 흔들려서. */
function nameMatches(candidate: string, expected: string): boolean {
  const a = candidate.replace(/\s+/g, '').toLowerCase();
  const b = expected.replace(/\s+/g, '').toLowerCase();
  return a.includes(b) || b.includes(a);
}

function firstRelevantRank(places: CandidatePlace[], relevant: string[]): number {
  for (let i = 0; i < places.length; i += 1) {
    if (relevant.some((name) => nameMatches(places[i]!.name, name))) return i + 1;
  }
  return 0;
}

/** 결과 장소가 목적지 지역에 속하는지 — 주소 첫 토큰(시도)·둘째 토큰(시군구) 코드로 본다. */
function inExpectedRegion(place: CandidatePlace, expected: string): boolean {
  const tokens = (place.address ?? '').trim().split(/\s+/);
  const sido = toSidoCode(tokens[0] ?? '');
  const sigungu = toSigunguCode(tokens[1] ?? '');
  return sido === expected || sigungu === expected;
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

  const result = await deps.retrieval.retrieve({
    userId: 'eval-harness',
    destination: testCase.destination,
    limit,
    ...(testCase.tasteTags ? { tasteTags: testCase.tasteTags } : {}),
    ...(testCase.trigger ? { trigger: testCase.trigger } : {}),
    ...(testCase.notes ? { notes: testCase.notes } : {}),
    ...(preferenceVector ? { preferenceVector } : {}),
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
    averageConfidence: result.trace.averageConfidence,
    sources: result.trace.sources,
    fallbackUsed: result.trace.fallbackUsed,
    hits,
    misses,
  };
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
    averageConfidence: mean(metrics.map((m) => m.averageConfidence)),
    pgvectorOnly: metrics.filter((m) => !m.fallbackUsed).length,
  };
}

function printAggregate(agg: ReturnType<typeof aggregate>, ks: number[]): void {
  console.log(
    `평균 ${ks.map((k) => `recall@${k} ${agg.recall[k]!.toFixed(3)}`).join(' | ')} | ` +
      `카탈로그내 recall ${agg.recallInCatalog.toFixed(3)} | 적재 커버리지 ${pct(agg.catalog)} | ` +
      `MRR ${agg.mrr.toFixed(3)} | 지역정합 ${pct(agg.regionPrecision)} | ` +
      `금지어 ${agg.forbiddenHits} | conf ${agg.averageConfidence.toFixed(3)} | ` +
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
