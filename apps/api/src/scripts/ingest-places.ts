/**
 * 카카오 로컬 + 관광공사 + 네이버 인기 장소를 임베딩해서 place_embeddings 에 적재하는 CLI.
 *
 * 실행:
 *   cd apps/api && pnpm ingest:places
 *   pnpm ingest:places -- --sources=popular --max=60   # 1차: 대표 명소·맛집만 얕고 정확하게
 *   pnpm ingest:places -- --regions=서울,부산 --sources=tour,kakao --max=100
 *   pnpm ingest:places -- --append --max=100   # 크론 반복 시 페이지 이어 누적
 *
 * 옵션:
 *   --regions=서울,부산   특정 시도만 적재 (미지정 시 전국 시도)
 *   --sources=tour,kakao  적재 소스 (기본: tour,kakao — popular 은 명시해야 돈다)
 *   --max=100             소스별 시도당 최대 수집 건수 (기본 100)
 *   --reseed              적재 전 대상 지역의 기존 벡터 삭제 (임베딩 서버 전환 시)
 *   --append              지역별 페이지 커서를 이어받아 새 페이지부터 적재 (크론 반복 시 누적)
 *   --allow-hash          임베딩 서버가 없어도 해시 폴백으로 적재 강행 (기본: 중단)
 *   --keywords=a,b        keyword 소스가 적재할 장소명 (이 소스를 쓸 때 필수)
 *
 * 소스:
 *   tour     KTO areaBasedList2 — 지역 전역을 넓게 채운다 (일일 호출 예산 있음)
 *   kakao    앞선 소스 좌표를 앵커로 주변 카테고리 검색 — 카카오 전용 장소 보강
 *   keyword  운영자가 이름을 직접 지정 → 카카오 키워드 검색으로 정본을 받아 적재.
 *            위 소스들이 **구조적으로 못 닿는** 장소용이다 — KTO 미등록 + 카카오
 *            `category_group_code` 가 빈 문서('자만벽화마을') + 서브지역 코퍼스가 안 만들어져
 *            popular 도 비는 경우('전리단길'). 지역 검증·적격 게이트는 다른 소스와 동일하다.
 *              pnpm ingest:places -- --regions=부산 --sources=keyword --keywords=전리단길
 *   popular  네이버 추천 글에 자주 언급되는 대표 명소·맛집을 카카오로 정규화해 적재.
 *            KTO 는 인기순 정렬이 없어 남산서울타워·설악산 같은 대표 명소를 못 잡는다.
 *            네이버 검색 키(NAVER_SEARCH_CLIENT_ID/_SECRET) 필수 — 없으면 시작 시 중단한다.
 *            페이지 커서가 없어 --append 대상이 아니다(매 실행 상위 장소 재확인 → unchanged).
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

function isIngestSource(value: string): value is IngestSource {
  return value === 'tour' || value === 'kakao' || value === 'popular' || value === 'keyword';
}

function parseArgs(argv: string[]): IngestOptions {
  const options: IngestOptions = {};
  for (const arg of argv) {
    const [rawKey, rawValue] = arg.replace(/^--/, '').split('=');
    const value = rawValue?.trim();
    if (rawKey === 'reseed') {
      options.reseed = true;
      continue;
    }
    if (rawKey === 'append') {
      options.append = true;
      continue;
    }
    if (rawKey === 'allow-hash') {
      options.allowHash = true;
      continue;
    }
    if (rawKey === 'keywords' && value) {
      options.keywords = value.split(',').map((k) => k.trim()).filter(Boolean);
      continue;
    }
    if (!value) continue;
    if (rawKey === 'regions') {
      options.regions = value.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (rawKey === 'sources') {
      const requested = value.split(',').map((s) => s.trim()).filter(Boolean);
      const unknown = requested.filter((s) => !isIngestSource(s));
      // 오타를 조용히 버리면 sources=[] 로 아무것도 적재하지 않고 성공한 것처럼 끝난다.
      if (unknown.length > 0) {
        throw new Error(
          `알 수 없는 소스: ${unknown.join(', ')} (가능: tour, kakao, popular)`,
        );
      }
      options.sources = requested.filter(isIngestSource);
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
        `${r.region.padEnd(8)} 수집 ${String(r.fetched).padStart(4)} | 신규 ${String(r.inserted).padStart(4)} | 갱신 ${String(r.updated).padStart(4)} | 유지 ${String(r.unchanged).padStart(4)} | 중복 ${String(r.duplicates).padStart(4)} | 삭제 ${String(r.deleted).padStart(4)}`,
      );
    }
    console.log(
      `----\n총 수집 ${summary.totalFetched} | 총 신규 ${summary.totalInserted} | 총 갱신 ${summary.totalUpdated} | 총 유지 ${summary.totalUnchanged} | 총 중복 ${summary.totalDuplicates} | 총 삭제 ${summary.totalDeleted}`,
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
