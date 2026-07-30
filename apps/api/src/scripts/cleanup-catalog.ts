/**
 * 장소 카탈로그(place_embeddings)에서 **장소가 아닌 행**을 걷어내는 일회성 정리 CLI.
 *
 * 대상 부류 (판별 근거는 place-name-quality.ts·place-eligibility.ts·near-duplicate.ts 주석):
 *   seo      검색 노출용 문구를 상호로 등록한 SEO 상호 — '경주맛집'·'다솥맛집'·'기차여행'
 *   course   KTO 여행코스 중 장소가 아니라 큐레이션 **기사**인 행
 *   coords   국내 좌표 범위를 벗어난 placeholder 좌표 행
 *   lodging  숙박(category=accommodation) — v1 은 숙소를 일정 항목으로 다루지 않는다
 *   dup      이름+좌표가 같은 소스 간 중복 행 (한 장소당 정보가 가장 많은 하나만 남긴다)
 *
 * 왜 마이그레이션이 아닌가 — 삭제는 스키마가 아니라 데이터 청소이고, 같은 행은 적재를 다시
 * 돌리면 되살아난다. 재발 차단은 적재·검색 게이트(place-name-quality)가 정본이고 이 스크립트는
 * 그 게이트가 생기기 전에 들어온 행만 걷어낸다. 그래서 프로덕션에서도 필요할 때 한 번 돌린다.
 *
 * 실행:
 *   cd apps/api
 *   pnpm cleanup:catalog                    # dry-run — 무엇을 지울지만 보고
 *   pnpm cleanup:catalog -- --apply         # 실제 삭제
 *   pnpm cleanup:catalog -- --only=seo      # 한 부류만
 *
 * 옵션:
 *   --apply         실제로 삭제한다 (기본은 dry-run)
 *   --only=a,b      대상 부류 선택 (seo, course, coords, lodging, dup / 기본 전부)
 *   --samples=30    보고할 표본 수 (기본 30)
 *
 * course 판정은 KTO 에 "이 시도의 여행코스 목록"을 되물어(areaBasedList2 contentTypeId=25)
 * 확정 집합을 만든 뒤 이름 모양을 본다. 이름만 보면 실제 코스명·명소가 함께 죽기 때문이다.
 * KTO 키가 없으면 course 단계는 건너뛴다(seo 는 키 없이 동작).
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { PlaceIngestionModule } from '../planner/retrieval/place-ingestion.module';
import {
  isSeoBusinessName,
  isTravelCourseArticle,
} from '../planner/retrieval/place-name-quality';
import { TRAVEL_COURSE_CONTENT_TYPE, TourApiService } from '../planner/retrieval/tour-api.service';
import { isPlausibleKoreanCoordinate } from '../planner/retrieval/place-eligibility';
import {
  SAME_PLACE_RADIUS_M,
  metersBetween,
  normalizeCatalogName,
} from '../planner/retrieval/near-duplicate';

type Target = 'seo' | 'course' | 'coords' | 'lodging' | 'dup';

const ALL_TARGETS: readonly Target[] = ['seo', 'course', 'coords', 'lodging', 'dup'];

interface CatalogRow {
  id: string;
  name: string;
  address: string | null;
  category: string | null;
  opening_hours: string | null;
  image_url: string | null;
  created_at: string;
  destination_region: string | null;
  tourism_api_id: string | null;
  coordinates: { lat: number; lng: number } | null;
}

interface Options {
  apply: boolean;
  targets: Target[];
  samples: number;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { apply: false, targets: [...ALL_TARGETS], samples: 30 };
  for (const arg of argv) {
    const [rawKey, rawValue] = arg.replace(/^--/, '').split('=');
    const value = rawValue?.trim();
    if (rawKey === 'apply') {
      options.apply = true;
      continue;
    }
    if (!value) continue;
    if (rawKey === 'only') {
      const requested = value.split(',').map((s) => s.trim()).filter(Boolean);
      const valid = new Set<Target>(ALL_TARGETS);
      const unknown = requested.filter((s) => !valid.has(s as Target));
      // 오타를 조용히 버리면 아무것도 안 지우고 성공한 것처럼 끝난다.
      if (unknown.length > 0) {
        throw new Error(`알 수 없는 대상: ${unknown.join(', ')} (가능: ${[...valid].join(', ')})`);
      }
      options.targets = requested as Target[];
    } else if (rawKey === 'samples') {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0) options.samples = Math.floor(parsed);
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
    const dataSource = app.get(DataSource);
    const tourApi = app.get(TourApiService);

    const rows: CatalogRow[] = await dataSource.query(
      `SELECT id, name, address, category, opening_hours, image_url, created_at,
              destination_region, tourism_api_id, coordinates
       FROM place_embeddings`,
    );
    console.log(`\n카탈로그 ${rows.length}행 검사`);

    const doomed = new Map<string, { row: CatalogRow; reason: Target }>();

    if (options.targets.includes('seo')) {
      const hits = rows.filter((row) => isSeoBusinessName(row.name));
      for (const row of hits) doomed.set(row.id, { row, reason: 'seo' });
      report('SEO 상호', hits, options.samples);
    }

    if (options.targets.includes('coords')) {
      // KTO placeholder 좌표(실측 3행이 전부 남중국해 `19.694, 117.993`). 지도 마커가 바다에
      // 찍히고 이동시간이 수천 km 로 계산되므로 후보로 남길 이유가 없다. 적재·검색에도 게이트가
      // 있지만(재적재하면 안 들어온다) 이미 들어온 행은 여기서 지운다.
      const hits = rows.filter(
        (row) => !row.coordinates || !isPlausibleKoreanCoordinate(row.coordinates),
      );
      for (const row of hits) doomed.set(row.id, { row, reason: 'coords' });
      report('좌표 불량', hits, options.samples);
    }

    if (options.targets.includes('lodging')) {
      // 숙박은 방문 일정 후보가 아니다(place-eligibility 의 EXCLUDED_CATEGORIES 참고).
      // 적재·검색 게이트가 이미 막지만, 규칙이 생기기 전에 들어온 행은 여기서 걷는다.
      const hits = rows.filter((row) => row.category === 'accommodation');
      for (const row of hits) doomed.set(row.id, { row, reason: 'lodging' });
      report('숙박', hits, options.samples);
    }

    if (options.targets.includes('dup')) {
      // 이름+좌표가 같은 소스 간 중복. 적재 dedupe 는 한 실행 안에서만 돌았고 DB 조회는 ID 로만
      // 해서(findSamePlace 가 생기기 전) 같은 장소가 KTO·카카오 두 행으로 들어왔다.
      const groups = collectDuplicateGroups(rows);
      const hits = groups.flatMap((group) => group.drop);
      for (const row of hits) doomed.set(row.id, { row, reason: 'dup' });
      console.log(`\n[dup] 중복 무리 ${groups.length}개 → 삭제 ${hits.length}건 (무리당 1행 유지)`);
      reportDuplicateGroups(groups, options.samples);
    }

    if (options.targets.includes('course')) {
      const courseIds = await collectCourseContentIds(tourApi);
      if (courseIds === null) {
        console.log('\n[course] KTO 키가 없어 여행코스 단계를 건너뜁니다.');
      } else {
        const courseRows = rows.filter(
          (row) => row.tourism_api_id && courseIds.has(row.tourism_api_id),
        );
        const hits = courseRows.filter((row) =>
          isTravelCourseArticle(row.name, row.address ?? ''),
        );
        for (const row of hits) doomed.set(row.id, { row, reason: 'course' });
        console.log(
          `\n[course] KTO 여행코스 contentId ${courseIds.size}건 중 카탈로그에 있는 행 ${courseRows.length}건` +
            ` → 기사 ${hits.length}건 삭제 / 실제 코스명 ${courseRows.length - hits.length}건 유지`,
        );
        report('여행코스 기사', hits, options.samples);
        // 유지되는 쪽도 표본을 보여야 "코스명이 통째로 죽지 않았는지" 눈으로 확인된다.
        report(
          '유지되는 코스명(참고)',
          courseRows.filter((row) => !isTravelCourseArticle(row.name, row.address ?? '')),
          Math.min(options.samples, 10),
        );
      }
    }

    const ids = [...doomed.keys()];
    console.log(`\n삭제 대상 합계 ${ids.length}건`);
    if (ids.length === 0) {
      console.log('정리할 행이 없습니다.');
      return;
    }

    if (!options.apply) {
      console.log('dry-run 입니다. 실제로 지우려면 --apply 를 붙여 다시 실행하세요.');
      return;
    }

    await dataSource.query(`DELETE FROM place_embeddings WHERE id = ANY($1::uuid[])`, [ids]);
    console.log(`삭제 완료 ${ids.length}건`);
  } finally {
    await app.close();
  }
}

interface DuplicateGroup {
  keep: CatalogRow;
  drop: CatalogRow[];
}

/**
 * 이름(정규화)이 같고 {@link SAME_PLACE_RADIUS_M} 이내인 행을 한 무리로 묶는다.
 * 이름이 같아도 멀리 떨어진 동명 장소(도시마다 있는 '중앙시장' 등)는 다른 무리로 남는다.
 */
function collectDuplicateGroups(rows: CatalogRow[]): DuplicateGroup[] {
  const byName = new Map<string, CatalogRow[]>();
  for (const row of rows) {
    if (!row.coordinates) continue; // 좌표 불량은 coords 부류가 따로 처리한다
    const key = normalizeCatalogName(row.name);
    const bucket = byName.get(key) ?? [];
    bucket.push(row);
    byName.set(key, bucket);
  }

  const groups: DuplicateGroup[] = [];
  for (const sameName of byName.values()) {
    if (sameName.length < 2) continue;
    const clusters: CatalogRow[][] = [];
    for (const row of sameName) {
      const cluster = clusters.find((members) =>
        members.some(
          (member) => metersBetween(member.coordinates!, row.coordinates!) <= SAME_PLACE_RADIUS_M,
        ),
      );
      if (cluster) cluster.push(row);
      else clusters.push([row]);
    }
    for (const cluster of clusters) {
      if (cluster.length < 2) continue;
      const [keep, ...drop] = [...cluster].sort(byKeepPriority);
      groups.push({ keep: keep!, drop });
    }
  }
  return groups;
}

/**
 * 무리에서 남길 행의 우선순위 — 정보가 많은 쪽을 남긴다.
 * 영업시간 > 대표 이미지 > 먼저 적재된 행(결정적 tie-break).
 * 영업시간을 1순위로 두는 이유는 그것만 Constraint Engine 이 실제로 소비하고 카카오 소스는
 * 아예 못 주는 값이라, 잃으면 다시 채울 경로가 KTO 재조회뿐이어서다.
 */
function byKeepPriority(a: CatalogRow, b: CatalogRow): number {
  const score = (row: CatalogRow): number => (row.opening_hours ? 2 : 0) + (row.image_url ? 1 : 0);
  const diff = score(b) - score(a);
  if (diff !== 0) return diff;
  return String(a.created_at).localeCompare(String(b.created_at));
}

function reportDuplicateGroups(groups: DuplicateGroup[], samples: number): void {
  for (const group of groups.slice(0, samples)) {
    const info = (row: CatalogRow): string =>
      [row.opening_hours ? '영업시간' : null, row.image_url ? '이미지' : null].filter(Boolean).join('+') ||
      '부가정보 없음';
    console.log(`  유지 ${group.keep.name} | ${group.keep.category ?? '-'} | ${info(group.keep)}`);
    for (const row of group.drop) {
      const distance = Math.round(metersBetween(group.keep.coordinates!, row.coordinates!));
      console.log(`    ↳ 삭제 ${row.name} | ${info(row)} | ${distance}m`);
    }
  }
  if (groups.length > samples) console.log(`  … 외 ${groups.length - samples}무리`);
}

/** 전국 시도의 여행코스 contentId 집합. KTO 키가 없으면 null. */
async function collectCourseContentIds(tourApi: TourApiService): Promise<Set<string> | null> {
  const sidos = await tourApi.fetchSidoList();
  if (sidos.length === 0) return null;

  const ids = new Set<string>();
  for (const sido of sidos) {
    const contentIds = await tourApi.fetchContentIds(sido.code, TRAVEL_COURSE_CONTENT_TYPE);
    for (const id of contentIds) ids.add(id);
    console.log(`  [${sido.name}] 여행코스 ${contentIds.length}건`);
  }
  return ids;
}

function report(label: string, rows: CatalogRow[], samples: number): void {
  console.log(`\n[${label}] ${rows.length}건`);
  for (const row of rows.slice(0, samples)) {
    const region = row.destination_region ?? '-';
    const address = row.address?.trim() ? row.address : '(주소 없음)';
    console.log(`  ${row.name} | ${row.category ?? '-'} | ${region} | ${address}`);
  }
  if (rows.length > samples) console.log(`  … 외 ${rows.length - samples}건`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
