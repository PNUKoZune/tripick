/**
 * 랜드마크 이름 흡수 계측 (일회성).
 *
 * 왜 — `NaverPopularityIndex.matchKeys` 의 **토큰 폴백**은 장식적 등록명을 살리려고 넣은 것인데
 * ('대구 서문시장 & 서문시장 야시장' → '서문시장'), 상호에 박힌 랜드마크 이름도 같이 살린다
 * ('동양백반 경주황리단길 본점' → '경주황리단길'). 전자는 그 장소의 정체성이고 후자는 남의
 * 인지도다. 고치기 전에 **실제로 얼마나 일어나는지** 를 먼저 센다.
 *
 * 판정 방법: 이름의 공백을 지우면 토큰이 하나가 되어 토큰 폴백이 꺼진다. 그 값(전체명 언급)이
 * 0 인데 원래 이름의 언급이 0 보다 크면, 그 점수는 전부 토큰에서 온 것이다.
 *
 * 실행: cd apps/api && pnpm ts-node -r tsconfig-paths/register src/scripts/measure-name-absorption.ts <eval.json>
 */
import 'reflect-metadata';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { NaverSearchService } from '../planner/retrieval/naver-search.service';

@Module({ imports: [ConfigModule.forRoot({ isGlobal: true })], providers: [NaverSearchService] })
class MeasureModule {}

interface TopRow {
  name: string;
  category: string;
  terms: { popularity: number };
}

async function main(): Promise<void> {
  const jsonPath = process.argv[2];
  if (!jsonPath) throw new Error('eval JSON 경로가 필요합니다');
  const app = await NestFactory.createApplicationContext(MeasureModule, { logger: false });
  const naver = app.get(NaverSearchService);

  const goldenPath = resolve(__dirname, 'retrieval-golden-set.json');
  const golden = JSON.parse(readFileSync(goldenPath, 'utf8'));
  const cases: Array<{ id: string; destination: string }> = golden.cases ?? golden;
  const run = JSON.parse(readFileSync(resolve(jsonPath), 'utf8')).runs[0];

  let total = 0;
  let absorbed = 0;
  const byCategory = new Map<string, number>();

  for (const evalCase of run.cases as Array<{ id: string; top: TopRow[] }>) {
    const destination = cases.find((c) => c.id === evalCase.id)?.destination;
    if (!destination) continue;
    const index = await naver.getPopularityIndex(destination);

    const rows: string[] = [];
    for (const row of evalCase.top) {
      total += 1;
      const whole = index.mentions(row.name.replace(/\s+/g, ''));
      const actual = index.mentions(row.name);
      if (whole === 0 && actual > 0) {
        absorbed += 1;
        byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + 1);
        rows.push(
          `    ${row.name} [${row.category}] 전체명 0회 → 토큰 ${actual}회, popularity ${row.terms.popularity.toFixed(2)}`,
        );
      }
    }
    if (rows.length > 0) {
      console.log(`  [${evalCase.id}] ${rows.length}/${evalCase.top.length}건`);
      rows.forEach((r) => console.log(r));
    }
  }

  console.log(`\n토큰 폴백으로만 점수를 얻은 후보: ${absorbed}/${total} (${((absorbed / total) * 100).toFixed(1)}%)`);
  console.log('  카테고리별:', [...byCategory].map(([k, v]) => `${k} ${v}`).join(' · '));
  await app.close();
}

void main();
