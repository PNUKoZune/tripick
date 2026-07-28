/**
 * pgvector 유사도의 실제 분포 측정 (일회성 계측).
 *
 * 왜 — CRAG `retrieval` 항은 `(similarity + 1) / 2` 로 코사인 -1~1 을 가정하는데, 실제 후보는
 * 좁은 밴드에만 몰려 총점 변별력을 못 만든다는 제보가 있다. 재보정을 하려면 ① 지금 밴드가
 * 정확히 어디인지 ② 그 안에서 similarity 가 **정답을 실제로 가르는지**(안 가르면 날카롭게
 * 만들 이유가 없다) 를 먼저 재야 한다.
 *
 * 실행: cd apps/api && pnpm ts-node -r tsconfig-paths/register src/scripts/measure-retrieval-similarity.ts
 *
 * 계측 방식은 파이프라인 로직을 다시 쓰지 않는다 — 실제 `PlaceRetrievalService.retrieve` 를
 * 그대로 호출하고 `PlaceEmbeddingRepository.searchByEmbedding` 의 반환을 가로채, 질의 벡터
 * 구성·취향 블렌드·지역 필터가 전부 운영과 동일한 상태의 후보 풀을 본다.
 */
import 'reflect-metadata';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { ReplanTrigger, TasteTagDto } from '@tripick/types';
import { CragEvaluatorService } from '../planner/retrieval/crag-evaluator.service';
import { KakaoLocalService } from '../planner/retrieval/kakao-local.service';
import { NaverSearchService } from '../planner/retrieval/naver-search.service';
import { PlaceEmbeddingRepository } from '../planner/retrieval/place-embedding.repository';
import { PlaceRetrievalService } from '../planner/retrieval/place-retrieval.service';
import { TextEmbeddingService } from '../embedding/text-embedding.service';
import { buildPreferenceText } from '../preferences/preference-text';
import { termWeights } from '../planner/retrieval/retrieval-rank';
import type { CandidatePlace, RawPlaceCandidate } from '../planner/retrieval/types';

/** 실효 가중치 — 실행 시점 `CRAG_RETRIEVAL_WEIGHT` 를 반영한다(하드코딩 사본을 두면 드리프트). */
const TERM_WEIGHTS = termWeights(
  Number.isFinite(Number(process.env.CRAG_RETRIEVAL_WEIGHT))
    ? Number(process.env.CRAG_RETRIEVAL_WEIGHT)
    : undefined,
) as unknown as Record<string, number | undefined>;

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
  ],
})
class MeasureModule {}

interface GoldenCase {
  id: string;
  destination: string;
  trigger?: ReplanTrigger;
  notes?: string;
  limit?: number;
  tasteTags?: TasteTagDto;
  relevant: string[];
}

/** 평가 하네스와 동일한 매칭 규칙 (3자 미만 부분일치 금지). */
function nameMatches(candidate: string, expected: string): boolean {
  const a = candidate.replace(/\s+/g, '').toLowerCase();
  const b = expected.replace(/\s+/g, '').toLowerCase();
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  if (shorter.length < 3) return false;
  return a.includes(b) || b.includes(a);
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const low = Math.floor(pos);
  const high = Math.ceil(pos);
  if (low === high) return sorted[low]!;
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (pos - low);
}

function mean(values: number[]): number {
  if (values.length === 0) return NaN;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    min: sorted[0] ?? NaN,
    p5: quantile(sorted, 0.05),
    p25: quantile(sorted, 0.25),
    p50: quantile(sorted, 0.5),
    p75: quantile(sorted, 0.75),
    p95: quantile(sorted, 0.95),
    max: sorted[sorted.length - 1] ?? NaN,
  };
}

/**
 * 정답 후보가 풀 안에서 유사도 상위 몇 %인지의 평균 = AUC.
 * 0.5 면 유사도 순서가 정답을 전혀 못 가른다는 뜻이고, 1.0 이면 완벽히 가른다.
 */
function auc(relevantScores: number[], otherScores: number[]): number {
  if (relevantScores.length === 0 || otherScores.length === 0) return NaN;
  let wins = 0;
  for (const r of relevantScores) {
    for (const o of otherScores) {
      if (r > o) wins += 1;
      else if (r === o) wins += 0.5;
    }
  }
  return wins / (relevantScores.length * otherScores.length);
}

function f(value: number, digits = 3): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '  -  ';
}

async function main() {
  const setPath = resolve(__dirname, 'retrieval-golden-set.json');
  const goldenSet = JSON.parse(readFileSync(setPath, 'utf8')) as { cases: GoldenCase[] };

  const app = await NestFactory.createApplicationContext(MeasureModule, {
    logger: ['warn', 'error'],
  });

  try {
    const retrieval = app.get(PlaceRetrievalService);
    const embeddings = app.get(TextEmbeddingService);
    const repo = app.get(PlaceEmbeddingRepository);

    // 해시 폴백이면 분포 자체가 다른 이야기가 되므로 먼저 확인한다.
    const probe = await embeddings.embedWithSource('임베딩 소스 확인');
    console.log(
      `임베딩 소스=${probe.source} 차원=${probe.remoteDimensions ?? probe.vector.length}` +
        (probe.source === 'hash' ? ' ⚠️ 해시 폴백 — 원격 임베딩 서버를 먼저 띄우세요' : ''),
    );

    let captured: RawPlaceCandidate[] = [];
    const original = repo.searchByEmbedding.bind(repo);
    (repo as unknown as { searchByEmbedding: typeof original }).searchByEmbedding = async (
      ...args: Parameters<typeof original>
    ) => {
      const rows = await original(...args);
      captured = rows;
      return rows;
    };

    // 항목별 변별력을 보려면 accept 게이트·top-16 이전의 **채점된 전체 풀**이 필요하다.
    const evaluator = app.get(CragEvaluatorService);
    let scored: CandidatePlace[] = [];
    const originalRank = evaluator.rank.bind(evaluator);
    (evaluator as unknown as { rank: typeof originalRank }).rank = (...args) => {
      const result = originalRank(...args);
      scored = result;
      return result;
    };
    const termAuc: Record<string, number[]> = {};
    const termValues: Record<string, number[]> = {};

    const allSim: number[] = [];
    const allPref: number[] = [];
    const relevantSim: number[] = [];
    const otherSim: number[] = [];
    const relevantPref: number[] = [];
    const otherPref: number[] = [];
    const perCaseAuc: number[] = [];
    const perCasePrefAuc: number[] = [];

    console.log(
      `\n${'case'.padEnd(24)}${'pool'.padStart(5)}${'min'.padStart(7)}${'p5'.padStart(7)}` +
        `${'p50'.padStart(7)}${'p95'.padStart(7)}${'max'.padStart(7)}` +
        `${'spread'.padStart(8)}${'ret폭'.padStart(8)}${'정답n'.padStart(7)}${'AUC'.padStart(7)}`,
    );
    console.log('-'.repeat(100));

    for (const testCase of goldenSet.cases) {
      const limit = testCase.limit ?? 16;
      const preferenceVector = testCase.tasteTags
        ? await embeddings.embed(buildPreferenceText(testCase.tasteTags))
        : undefined;

      captured = [];
      await retrieval.retrieve({
        userId: 'similarity-probe',
        destination: testCase.destination,
        limit,
        ...(testCase.tasteTags ? { tasteTags: testCase.tasteTags } : {}),
        ...(testCase.trigger ? { trigger: testCase.trigger } : {}),
        ...(testCase.notes ? { notes: testCase.notes } : {}),
        ...(preferenceVector ? { preferenceVector } : {}),
      });

      const pool = captured;
      const sims = pool.map((c) => c.similarity).filter((v): v is number => v !== undefined);
      const prefs = pool
        .map((c) => c.preferenceSimilarity)
        .filter((v): v is number => v !== undefined);
      const s = stats(sims);

      const isRelevant = (candidate: RawPlaceCandidate): boolean =>
        testCase.relevant.some((name) => nameMatches(candidate.name, name));
      const caseRelevantSim = pool.filter(isRelevant).map((c) => c.similarity!).filter(Number.isFinite);
      const caseOtherSim = pool.filter((c) => !isRelevant(c)).map((c) => c.similarity!).filter(Number.isFinite);
      const caseRelevantPref = pool.filter(isRelevant).map((c) => c.preferenceSimilarity!).filter(Number.isFinite);
      const caseOtherPref = pool.filter((c) => !isRelevant(c)).map((c) => c.preferenceSimilarity!).filter(Number.isFinite);
      const caseAuc = auc(caseRelevantSim, caseOtherSim);
      const casePrefAuc = auc(caseRelevantPref, caseOtherPref);

      allSim.push(...sims);
      allPref.push(...prefs);
      relevantSim.push(...caseRelevantSim);
      otherSim.push(...caseOtherSim);
      relevantPref.push(...caseRelevantPref);
      otherPref.push(...caseOtherPref);
      if (Number.isFinite(caseAuc)) perCaseAuc.push(caseAuc);
      if (Number.isFinite(casePrefAuc)) perCasePrefAuc.push(casePrefAuc);

      // 채점된 풀에서 항목별 AUC — 어느 항이 정답을 실제로 가르는지.
      const scoredRelevant = scored.filter(isRelevant);
      const scoredOther = scored.filter((c) => !isRelevant(c));
      const terms: Array<[string, (c: CandidatePlace) => number | undefined]> = [
        ['total', (c) => c.confidence],
        ['retrieval', (c) => c.crag.retrieval],
        ['taste', (c) => c.crag.taste],
        ['popularity', (c) => c.crag.popularity],
        ['locality', (c) => c.crag.locality],
        ['context', (c) => c.crag.context],
        ['availability', (c) => c.crag.availability],
        ['dataQuality', (c) => c.crag.dataQuality],
        ['personalization', (c) => c.crag.personalization],
      ];
      for (const [name, pick] of terms) {
        const r = scoredRelevant.map(pick).filter((v): v is number => v !== undefined);
        const o = scoredOther.map(pick).filter((v): v is number => v !== undefined);
        const value = auc(r, o);
        if (Number.isFinite(value)) (termAuc[name] ??= []).push(value);
        (termValues[name] ??= []).push(...r, ...o);
      }

      // 현재 공식의 retrieval 항 폭과, 그것이 총점(가중 0.24)에 만드는 실효 스프레드
      const retrievalSpread = (s.p95 - s.p5) / 2;
      console.log(
        testCase.id.padEnd(24) +
          String(sims.length).padStart(5) +
          f(s.min).padStart(7) +
          f(s.p5).padStart(7) +
          f(s.p50).padStart(7) +
          f(s.p95).padStart(7) +
          f(s.max).padStart(7) +
          f(s.max - s.min).padStart(8) +
          f(retrievalSpread).padStart(8) +
          String(caseRelevantSim.length).padStart(7) +
          f(caseAuc, 2).padStart(7),
      );
    }

    const pooled = stats(allSim);
    const pooledPref = stats(allPref);
    console.log('-'.repeat(100));
    console.log(
      `\n[유사도(질의벡터) 전체 ${pooled.n}건] min ${f(pooled.min)} p5 ${f(pooled.p5)} ` +
        `p25 ${f(pooled.p25)} p50 ${f(pooled.p50)} p75 ${f(pooled.p75)} p95 ${f(pooled.p95)} max ${f(pooled.max)}`,
    );
    console.log(
      `  → 현재 공식 (sim+1)/2 사상: ${f((pooled.p5 + 1) / 2)} ~ ${f((pooled.p95 + 1) / 2)} ` +
        `(폭 ${f((pooled.p95 - pooled.p5) / 2)}) · 가중 0.24 적용 시 총점 스프레드 ${f((0.24 * (pooled.p95 - pooled.p5)) / 2)}`,
    );
    console.log(
      `[취향 유사도 전체 ${pooledPref.n}건] min ${f(pooledPref.min)} p5 ${f(pooledPref.p5)} ` +
        `p50 ${f(pooledPref.p50)} p95 ${f(pooledPref.p95)} max ${f(pooledPref.max)} ` +
        `→ personalization 사상 ${f((pooledPref.p5 + 1) / 2)} ~ ${f((pooledPref.p95 + 1) / 2)}`,
    );
    console.log(
      `\n[변별력] 질의 유사도 AUC 전체 ${f(auc(relevantSim, otherSim), 3)} · 케이스평균 ${f(
        perCaseAuc.reduce((a, b) => a + b, 0) / (perCaseAuc.length || 1),
        3,
      )} (0.5=무의미)`,
    );
    console.log(
      `           취향 유사도 AUC 전체 ${f(auc(relevantPref, otherPref), 3)} · 케이스평균 ${f(
        perCasePrefAuc.reduce((a, b) => a + b, 0) / (perCasePrefAuc.length || 1),
        3,
      )}`,
    );
    console.log(
      `           정답 평균 유사도 ${f(relevantSim.reduce((a, b) => a + b, 0) / (relevantSim.length || 1))} ` +
        `vs 나머지 ${f(otherSim.reduce((a, b) => a + b, 0) / (otherSim.length || 1))}`,
    );

    console.log(
      `\n[CRAG 항목별] 채점된 전체 풀 기준 · AUC=변별력(0.5 무의미) · 실효스프레드=가중×(p95-p5)\n` +
        `${'term'.padEnd(16)}${'가중'.padStart(6)}${'AUC(케이스평균)'.padStart(16)}` +
        `${'p5'.padStart(8)}${'p50'.padStart(8)}${'p95'.padStart(8)}${'실효스프레드'.padStart(14)}`,
    );
    const ranked = Object.entries(termAuc).sort(
      (a, b) => mean(b[1]) - mean(a[1]),
    );
    for (const [name, values] of ranked) {
      const s = stats(termValues[name] ?? []);
      const weight = TERM_WEIGHTS[name];
      const effective = weight === undefined ? NaN : weight * (s.p95 - s.p5);
      console.log(
        name.padEnd(16) +
          (weight === undefined ? '(내부)' : f(weight, 2)).padStart(6) +
          f(mean(values)).padStart(16) +
          f(s.p5).padStart(8) +
          f(s.p50).padStart(8) +
          f(s.p95).padStart(8) +
          f(effective).padStart(14),
      );
    }
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('측정 실패:', err);
    process.exit(1);
  });
