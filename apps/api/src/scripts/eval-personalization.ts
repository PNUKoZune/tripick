/**
 * 개인화 및 그룹 추천의 counterfactual 오프라인 평가 하네스.
 *
 * 같은 목적지의 상반된 두 페르소나를 한 프로세스에서 다음 모드로 비교한다.
 *   generic          목적지만 사용
 *   tags-only        본인 취향 태그만 사용
 *   personalized     본인 취향 태그 + 취향 임베딩
 *   counterfactual   상대방 취향 태그 + 상대방 임베딩 (정답표는 본인 것을 유지)
 *   group-proxy      두 프로필의 태그 합집합 + 정규화한 평균 벡터
 *
 * Naver 코퍼스가 시시각각 바뀌므로 전후 결과 파일을 며칠 간격으로 비교하면 안 된다. 이 스크립트는
 * 목적지별 모든 모드를 연속 호출해 같은 인프로세스 코퍼스 캐시를 공유한다.
 *
 * 실행:
 *   cd apps/api
 *   pnpm eval:personalization
 *   pnpm eval:personalization -- --case=seoul-heritage-vs-city --k=10
 *   pnpm eval:personalization -- --json=personalization-eval.json
 *   pnpm eval:personalization -- --assert
 */
import 'reflect-metadata';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { TasteTagDto } from '@tripick/types';
import { TextEmbeddingService, type EmbeddingSource } from '../embedding/text-embedding.service';
import { buildPreferenceText } from '../preferences/preference-text';
import { CragEvaluatorService } from '../planner/retrieval/crag-evaluator.service';
import { DestinationAnchorService } from '../planner/retrieval/destination-anchor.service';
import { KakaoLocalService } from '../planner/retrieval/kakao-local.service';
import { NaverSearchService } from '../planner/retrieval/naver-search.service';
import { PlaceEmbeddingRepository } from '../planner/retrieval/place-embedding.repository';
import { PlaceRetrievalService } from '../planner/retrieval/place-retrieval.service';
import {
  evaluateGroupRanking,
  evaluateRanking,
  topKJaccard,
  type GroupRankingMetrics,
  type RankingMetrics,
} from './personalization-eval.metrics';

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
  ],
})
class PersonalizationEvalModule {}

interface Persona {
  id: string;
  label: string;
  tasteTags: TasteTagDto;
  relevant: string[];
}

interface PairedCase {
  id: string;
  destination: string;
  expectRegion?: string;
  personas: [Persona, Persona];
}

interface Expectations {
  minimumMeanNdcgLift?: number;
  minimumCounterfactualWinRate?: number;
  minimumGroupMemberCoverage?: number;
}

interface GoldenSet {
  version: number;
  expectations?: Expectations;
  cases: PairedCase[];
}

interface RankedRun {
  names: string[];
  sources: string[];
  fallbackUsed: boolean;
}

interface PersonaResult {
  id: string;
  label: string;
  generic: RankingMetrics;
  tagsOnly: RankingMetrics;
  personalized: RankingMetrics;
  counterfactual: RankingMetrics;
  liftVsGeneric: number;
  vectorLiftVsTags: number;
  counterfactualLift: number;
  topPersonalized: string[];
  topCounterfactual: string[];
}

interface CaseResult {
  id: string;
  destination: string;
  embeddingSources: EmbeddingSource[];
  personas: PersonaResult[];
  profileTopKJaccard: number;
  group: GroupRankingMetrics;
  groupTop: string[];
  retrievalSources: string[];
  fallbackUsed: boolean;
}

interface AggregateResult {
  cases: number;
  personas: number;
  genericNdcgAtK: number;
  tagsOnlyNdcgAtK: number;
  personalizedNdcgAtK: number;
  meanNdcgLiftVsGeneric: number;
  meanVectorLiftVsTags: number;
  meanCounterfactualLift: number;
  counterfactualWinRate: number;
  counterfactualTieRate: number;
  meanProfileTopKJaccard: number;
  groupAverageNdcgAtK: number;
  groupLeastNdcgAtK: number;
  groupMemberCoverageAtK: number;
  groupNdcgDisparity: number;
}

function parseArgs(argv: string[]) {
  const options = {
    setPath: resolve(__dirname, 'personalization-golden-set.json'),
    caseIds: [] as string[],
    k: 10,
    limit: 16,
    jsonPath: undefined as string | undefined,
    assert: false,
  };

  for (const arg of argv) {
    const [rawKey, ...rest] = arg.replace(/^--/, '').split('=');
    const value = rest.join('=').trim();
    if (rawKey === 'set' && value) options.setPath = resolve(process.cwd(), value);
    else if (rawKey === 'case' && value) {
      options.caseIds = value.split(',').map((item) => item.trim());
    } else if (rawKey === 'k' && Number(value) > 0) options.k = Math.floor(Number(value));
    else if (rawKey === 'limit' && Number(value) > 0) options.limit = Math.floor(Number(value));
    else if (rawKey === 'json' && value) options.jsonPath = resolve(process.cwd(), value);
    else if (rawKey === 'assert') options.assert = true;
  }
  options.limit = Math.max(options.limit, options.k);
  return options;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function normalizedMean(vectors: number[][]): number[] | undefined {
  if (vectors.length === 0) return undefined;
  const dimensions = vectors[0]?.length ?? 0;
  if (dimensions === 0 || vectors.some((vector) => vector.length !== dimensions)) return undefined;
  const centroid = Array<number>(dimensions).fill(0);
  for (const vector of vectors) {
    vector.forEach((value, index) => {
      centroid[index] = (centroid[index] ?? 0) + value / vectors.length;
    });
  }
  const norm = Math.sqrt(centroid.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) return undefined;
  return centroid.map((value) => value / norm);
}

function mergeTasteTags(personas: Persona[]): TasteTagDto {
  return {
    food: [...new Set(personas.flatMap((persona) => persona.tasteTags.food))],
    mood: [...new Set(personas.flatMap((persona) => persona.tasteTags.mood))],
    environment: [...new Set(personas.flatMap((persona) => persona.tasteTags.environment))],
    confidence: mean(personas.map((persona) => persona.tasteTags.confidence)),
  };
}

async function runRetrieval(
  retrieval: PlaceRetrievalService,
  testCase: PairedCase,
  limit: number,
  tasteTags?: TasteTagDto,
  preferenceVector?: number[],
): Promise<RankedRun> {
  const result = await retrieval.retrieve({
    userId: 'personalization-eval',
    destination: testCase.destination,
    limit,
    ...(tasteTags ? { tasteTags } : {}),
    ...(preferenceVector ? { preferenceVector } : {}),
  });
  return {
    names: result.places.map((place) => place.name),
    sources: result.trace.sources,
    fallbackUsed: result.trace.fallbackUsed,
  };
}

async function evaluateCase(
  testCase: PairedCase,
  retrieval: PlaceRetrievalService,
  embeddings: TextEmbeddingService,
  k: number,
  limit: number,
): Promise<CaseResult> {
  if (testCase.personas.length !== 2) {
    throw new Error(`${testCase.id}: counterfactual 평가는 정확히 두 persona가 필요합니다.`);
  }

  // generic을 먼저 실행해 목적지별 외부 코퍼스 캐시를 채운 뒤 나머지 모드를 같은 캐시로 비교한다.
  const generic = await runRetrieval(retrieval, testCase, limit);
  const embedded = await Promise.all(
    testCase.personas.map((persona) =>
      embeddings.embedWithSource(buildPreferenceText(persona.tasteTags)),
    ),
  );

  const ownRuns = await Promise.all(
    testCase.personas.map(async (persona, index) => ({
      tagsOnly: await runRetrieval(retrieval, testCase, limit, persona.tasteTags),
      personalized: await runRetrieval(
        retrieval,
        testCase,
        limit,
        persona.tasteTags,
        embedded[index]!.vector,
      ),
    })),
  );

  // A의 정답표로 B의 personalized 결과를 채점하는 것이 profile swap이다. 같은 호출을 한 번 더
  // 실행하지 않고 이미 얻은 상대 결과를 재사용해야 외부 상태가 끼어들 여지도 없다.
  const counterfactualRuns = [
    ownRuns[1]!.personalized,
    ownRuns[0]!.personalized,
  ] as const;

  const groupRun = await runRetrieval(
    retrieval,
    testCase,
    limit,
    mergeTasteTags(testCase.personas),
    normalizedMean(embedded.map((result) => result.vector)),
  );

  const personas = testCase.personas.map((persona, index): PersonaResult => {
    const genericMetrics = evaluateRanking(generic.names, persona.relevant, k);
    const tagsMetrics = evaluateRanking(ownRuns[index]!.tagsOnly.names, persona.relevant, k);
    const personalizedMetrics = evaluateRanking(
      ownRuns[index]!.personalized.names,
      persona.relevant,
      k,
    );
    const counterfactualMetrics = evaluateRanking(
      counterfactualRuns[index]!.names,
      persona.relevant,
      k,
    );
    return {
      id: persona.id,
      label: persona.label,
      generic: genericMetrics,
      tagsOnly: tagsMetrics,
      personalized: personalizedMetrics,
      counterfactual: counterfactualMetrics,
      liftVsGeneric: personalizedMetrics.ndcgAtK - genericMetrics.ndcgAtK,
      vectorLiftVsTags: personalizedMetrics.ndcgAtK - tagsMetrics.ndcgAtK,
      counterfactualLift: personalizedMetrics.ndcgAtK - counterfactualMetrics.ndcgAtK,
      topPersonalized: ownRuns[index]!.personalized.names.slice(0, k),
      topCounterfactual: counterfactualRuns[index]!.names.slice(0, k),
    };
  });

  return {
    id: testCase.id,
    destination: testCase.destination,
    embeddingSources: [...new Set(embedded.map((result) => result.source))],
    personas,
    profileTopKJaccard: topKJaccard(
      ownRuns[0]!.personalized.names,
      ownRuns[1]!.personalized.names,
      k,
    ),
    group: evaluateGroupRanking(
      groupRun.names,
      testCase.personas.map((persona) => ({ id: persona.id, relevant: persona.relevant })),
      k,
    ),
    groupTop: groupRun.names.slice(0, k),
    retrievalSources: [
      ...new Set([
        ...generic.sources,
        ...ownRuns.flatMap((run) => [...run.tagsOnly.sources, ...run.personalized.sources]),
        ...groupRun.sources,
      ]),
    ],
    fallbackUsed:
      generic.fallbackUsed ||
      ownRuns.some((run) => run.tagsOnly.fallbackUsed || run.personalized.fallbackUsed) ||
      groupRun.fallbackUsed,
  };
}

function aggregate(results: CaseResult[]): AggregateResult {
  const personas = results.flatMap((result) => result.personas);
  const counterfactualWins = personas.filter((persona) => persona.counterfactualLift > 1e-9).length;
  const counterfactualTies = personas.filter(
    (persona) => Math.abs(persona.counterfactualLift) <= 1e-9,
  ).length;
  return {
    cases: results.length,
    personas: personas.length,
    genericNdcgAtK: mean(personas.map((persona) => persona.generic.ndcgAtK)),
    tagsOnlyNdcgAtK: mean(personas.map((persona) => persona.tagsOnly.ndcgAtK)),
    personalizedNdcgAtK: mean(personas.map((persona) => persona.personalized.ndcgAtK)),
    meanNdcgLiftVsGeneric: mean(personas.map((persona) => persona.liftVsGeneric)),
    meanVectorLiftVsTags: mean(personas.map((persona) => persona.vectorLiftVsTags)),
    meanCounterfactualLift: mean(personas.map((persona) => persona.counterfactualLift)),
    counterfactualWinRate: personas.length === 0 ? 0 : counterfactualWins / personas.length,
    counterfactualTieRate: personas.length === 0 ? 0 : counterfactualTies / personas.length,
    meanProfileTopKJaccard: mean(results.map((result) => result.profileTopKJaccard)),
    groupAverageNdcgAtK: mean(results.map((result) => result.group.averageNdcgAtK)),
    groupLeastNdcgAtK: mean(results.map((result) => result.group.leastNdcgAtK)),
    groupMemberCoverageAtK: mean(results.map((result) => result.group.memberCoverageAtK)),
    groupNdcgDisparity: mean(results.map((result) => result.group.ndcgDisparity)),
  };
}

function printResults(results: CaseResult[], aggregateResult: AggregateResult, k: number): void {
  const header = [
    'case/persona'.padEnd(37),
    'generic'.padStart(8),
    'tags'.padStart(8),
    'full'.padStart(8),
    'swapped'.padStart(8),
    'lift'.padStart(8),
    'cf-lift'.padStart(8),
  ].join(' ');
  console.log(`\n=== 개인화 counterfactual 평가 (NDCG@${k}) ===`);
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const result of results) {
    for (const persona of result.personas) {
      console.log(
        [
          `${result.id}/${persona.id}`.padEnd(37),
          persona.generic.ndcgAtK.toFixed(3).padStart(8),
          persona.tagsOnly.ndcgAtK.toFixed(3).padStart(8),
          persona.personalized.ndcgAtK.toFixed(3).padStart(8),
          persona.counterfactual.ndcgAtK.toFixed(3).padStart(8),
          `${persona.liftVsGeneric >= 0 ? '+' : ''}${persona.liftVsGeneric.toFixed(3)}`.padStart(8),
          `${persona.counterfactualLift >= 0 ? '+' : ''}${persona.counterfactualLift.toFixed(3)}`.padStart(8),
        ].join(' '),
      );
    }
    console.log(
      `  group avg=${result.group.averageNdcgAtK.toFixed(3)} ` +
        `least=${result.group.leastNdcgAtK.toFixed(3)} ` +
        `coverage=${pct(result.group.memberCoverageAtK)} ` +
        `gap=${result.group.ndcgDisparity.toFixed(3)} ` +
        `profile-jaccard=${result.profileTopKJaccard.toFixed(3)}`,
    );
  }
  console.log('-'.repeat(header.length));
  console.log(
    `personalized ${aggregateResult.personalizedNdcgAtK.toFixed(3)} ` +
      `(generic 대비 ${aggregateResult.meanNdcgLiftVsGeneric >= 0 ? '+' : ''}${aggregateResult.meanNdcgLiftVsGeneric.toFixed(3)}, ` +
      `tags-only 대비 ${aggregateResult.meanVectorLiftVsTags >= 0 ? '+' : ''}${aggregateResult.meanVectorLiftVsTags.toFixed(3)})`,
  );
  console.log(
    `counterfactual 승 ${pct(aggregateResult.counterfactualWinRate)} / ` +
      `무승부 ${pct(aggregateResult.counterfactualTieRate)} / ` +
      `평균 lift ${aggregateResult.meanCounterfactualLift >= 0 ? '+' : ''}${aggregateResult.meanCounterfactualLift.toFixed(3)}`,
  );
  console.log(
    `group avg ${aggregateResult.groupAverageNdcgAtK.toFixed(3)} / ` +
      `least ${aggregateResult.groupLeastNdcgAtK.toFixed(3)} / ` +
      `member coverage ${pct(aggregateResult.groupMemberCoverageAtK)} / ` +
      `gap ${aggregateResult.groupNdcgDisparity.toFixed(3)}`,
  );
}

function assertExpectations(aggregateResult: AggregateResult, expectations: Expectations): void {
  const failures: string[] = [];
  const checks: Array<[keyof AggregateResult, keyof Expectations]> = [
    ['meanNdcgLiftVsGeneric', 'minimumMeanNdcgLift'],
    ['counterfactualWinRate', 'minimumCounterfactualWinRate'],
    ['groupMemberCoverageAtK', 'minimumGroupMemberCoverage'],
  ];
  for (const [metricKey, thresholdKey] of checks) {
    const threshold = expectations[thresholdKey];
    const actual = aggregateResult[metricKey];
    if (typeof threshold === 'number' && typeof actual === 'number' && actual < threshold) {
      failures.push(`${String(metricKey)}=${actual.toFixed(4)} < ${thresholdKey}=${threshold}`);
    }
  }
  if (failures.length > 0) throw new Error(`개인화 회귀 기준 미달:\n- ${failures.join('\n- ')}`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const goldenSet = JSON.parse(readFileSync(options.setPath, 'utf8')) as GoldenSet;
  const cases = options.caseIds.length
    ? goldenSet.cases.filter((testCase) => options.caseIds.includes(testCase.id))
    : goldenSet.cases;
  if (cases.length === 0) throw new Error('평가할 케이스가 없습니다. --case 필터를 확인하세요.');

  const app = await NestFactory.createApplicationContext(PersonalizationEvalModule, {
    logger: ['warn', 'error'],
  });
  try {
    const retrieval = app.get(PlaceRetrievalService);
    const embeddings = app.get(TextEmbeddingService);
    const results: CaseResult[] = [];
    for (const testCase of cases) {
      results.push(
        await evaluateCase(testCase, retrieval, embeddings, options.k, options.limit),
      );
    }
    const aggregateResult = aggregate(results);
    printResults(results, aggregateResult, options.k);

    if (options.jsonPath) {
      writeFileSync(
        options.jsonPath,
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            set: options.setPath,
            k: options.k,
            limit: options.limit,
            aggregate: Object.fromEntries(
              Object.entries(aggregateResult).map(([key, value]) => [
                key,
                typeof value === 'number' ? round(value) : value,
              ]),
            ),
            cases: results,
          },
          null,
          2,
        ),
      );
      console.log(`JSON 덤프: ${options.jsonPath}`);
    }
    if (options.assert) assertExpectations(aggregateResult, goldenSet.expectations ?? {});
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error('개인화 평가 실패:', error);
    process.exit(1);
  });
