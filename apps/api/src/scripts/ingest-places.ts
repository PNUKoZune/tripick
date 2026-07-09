/**
 * 카카오 로컬 + 관광공사 장소를 임베딩해서 place_embeddings 에 적재하는 CLI.
 *
 * 실행:
 *   cd apps/api && pnpm ingest:places
 *   pnpm ingest:places -- --regions=서울,부산 --sources=tour,kakao --max=100
 *
 * 옵션:
 *   --regions=서울,부산   특정 시도만 적재 (미지정 시 전국 시도)
 *   --sources=tour,kakao  적재 소스 (기본: 둘 다)
 *   --max=100             소스별 시도당 최대 수집 건수 (기본 100)
 *   --reseed              적재 전 대상 지역의 기존 벡터 삭제 (임베딩 서버 전환 시)
 *   --allow-hash          임베딩 서버가 없어도 해시 폴백으로 적재 강행 (기본: 중단)
 *
 * 안전장치: 기본적으로 임베딩 서버가 실제 벡터를 주지 못하면(해시 폴백) 적재를 중단한다.
 * 해시 벡터가 실제 벡터와 섞여 검색 품질이 손상되는 것을 막는다. 의도한 오프라인 적재는 --allow-hash.
 * 멱등성: kakao_place_id / tourism_api_id / (region,name) 중복은 삽입하지 않는다.
 * --reseed 를 주면 해당 지역을 먼저 비우고 새 임베딩으로 다시 채운다.
 * AppModule 전체(BullMQ/Redis)를 띄우지 않고 경량 PlaceIngestionModule 로 동작한다.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { PlaceIngestionModule } from '../planner/retrieval/place-ingestion.module';
import { PlaceIngestionService } from '../planner/retrieval/place-ingestion.service';
import type { IngestOptions } from '../planner/retrieval/place-ingestion.service';
import type { IngestSource } from '../planner/retrieval/ingestion.types';

function parseArgs(argv: string[]): IngestOptions {
  const options: IngestOptions = {};
  for (const arg of argv) {
    const [rawKey, rawValue] = arg.replace(/^--/, '').split('=');
    const value = rawValue?.trim();
    if (rawKey === 'reseed') {
      options.reseed = true;
      continue;
    }
    if (rawKey === 'allow-hash') {
      options.allowHash = true;
      continue;
    }
    if (!value) continue;
    if (rawKey === 'regions') {
      options.regions = value.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (rawKey === 'sources') {
      options.sources = value
        .split(',')
        .map((s) => s.trim())
        .filter((s): s is IngestSource => s === 'tour' || s === 'kakao');
    } else if (rawKey === 'max') {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) options.maxPerRegion = n;
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(PlaceIngestionModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const service = app.get(PlaceIngestionService);
    const summary = await service.ingest(options);

    console.log('\n=== 적재 요약 ===');
    for (const r of summary.regions) {
      console.log(
        `${r.region.padEnd(8)} 수집 ${String(r.fetched).padStart(4)} | 신규 ${String(r.inserted).padStart(4)} | 갱신 ${String(r.updated).padStart(4)} | 유지 ${String(r.unchanged).padStart(4)} | 삭제 ${String(r.deleted).padStart(4)}`,
      );
    }
    console.log(
      `----\n총 수집 ${summary.totalFetched} | 총 신규 ${summary.totalInserted} | 총 갱신 ${summary.totalUpdated} | 총 유지 ${summary.totalUnchanged} | 총 삭제 ${summary.totalDeleted}`,
    );
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('적재 실패:', err);
    process.exit(1);
  });
