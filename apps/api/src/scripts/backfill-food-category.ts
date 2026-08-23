/**
 * KTO 에서 온 카페·찻집·제과 행의 `category` 를 restaurant → cafe 로 고친다.
 *
 * 왜 — KTO 는 음식을 contentTypeId 39 한 덩어리로 주고, 적재가 그걸 통째로 restaurant 로
 * 매핑했다. 실제로는 전국 13,498건 중 3,176건(FD05 카페·찻집 + FD030100 제과)이 카페다.
 * 그래서 카탈로그의 카페는 카카오 소스에만 있었고(2,591건), 일정의 카페 자리가 만성적으로 비었다.
 * 게다가 같은 카페가 KTO(restaurant)·카카오(cafe) 두 행으로 남아 근접 중복 병합(카테고리 일치
 * 요구)을 빠져나가 한 날에 둘 다 배치됐다 — '카페그리너리'와 '그리너리'.
 *
 * 왜 재적재가 아니라 이 스크립트인가 — 적재를 다시 돌려 고치려면 전국 음식 13,498행을 다시
 * 읽어야 하고, 영업시간 조회가 장소당 1콜이라 일일 예산 900콜로는 며칠이 걸린다. 여기서는
 * "어느 contentId 가 카페인가"만 분류 필터로 물어보므로 시도당 2~3콜, 전국 40여 콜로 끝난다.
 *
 * 임베딩은 건드리지 않는다. category·category_detail 만 고친 뒤
 * `pnpm reembed:places -- --apply` 로 텍스트·벡터를 맞춘다 — 그 스크립트가 이미 DB 만으로
 * 적재와 같은 텍스트를 만들고 해시가 바뀐 행만 다시 임베딩한다.
 *
 * 실행:
 *   cd apps/api
 *   pnpm backfill:food-category              # dry-run — 몇 건이 바뀌는지만 보고
 *   pnpm backfill:food-category -- --apply
 *   pnpm reembed:places -- --apply           # 이어서 임베딩 텍스트 갱신
 *
 * 옵션:
 *   --apply        실제로 갱신한다 (기본은 dry-run)
 *   --samples=20   보고할 표본 수 (기본 20)
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { PlaceIngestionModule } from '../planner/retrieval/place-ingestion.module';
import {
  CAFE_FOOD_CLASSES,
  KtoCallBudget,
  TourApiService,
} from '../planner/retrieval/tour-api.service';

interface Options {
  apply: boolean;
  samples: number;
}

interface StaleRow {
  id: string;
  name: string;
  category: string | null;
  category_detail: string | null;
  destination_region: string | null;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { apply: false, samples: 20 };
  for (const arg of argv) {
    const [key, rawValue] = arg.replace(/^--/, '').split('=');
    const value = rawValue?.trim();
    if (key === 'apply') options.apply = true;
    else if (key === 'samples' && value) {
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
    const config = app.get(ConfigService);

    const budget = new KtoCallBudget(Number(config.get('KTO_DAILY_CALL_BUDGET', 900)));
    const sidos = await tourApi.fetchSidoList();
    if (sidos.length === 0) {
      throw new Error('KTO 시도 목록을 못 받았습니다 (KTO_API_KEY 확인).');
    }

    // contentId → 이 행에 박을 categoryDetail. 같은 id 가 두 필터에 걸릴 일은 없지만,
    // 겹치면 뒤(제과)가 이긴다 — 소분류가 중분류보다 구체적이다.
    const cafeIds = new Map<string, string>();
    for (const sido of sidos) {
      for (const foodClass of CAFE_FOOD_CLASSES) {
        const ids = await tourApi.fetchFoodClassContentIds(sido.code, foodClass, budget);
        ids.forEach((id) => cafeIds.set(id, foodClass.categoryDetail));
      }
      if (budget.isExhausted) {
        // 예산이 끊긴 채로 진행하면 "안 걸린 id = 카페 아님"이 되어 남은 시도가 통째로 누락된다.
        throw new Error(
          `KTO 일일 호출 예산이 소진됐습니다 (${sido.name} 까지 수집). 내일 다시 실행하세요.`,
        );
      }
    }
    console.log(`KTO 카페 분류 contentId ${cafeIds.size}건 수집 (시도 ${sidos.length})`);

    const ids = [...cafeIds.keys()];
    const rows: StaleRow[] = await dataSource.query(
      `SELECT id, name, category, category_detail, destination_region
       FROM place_embeddings
       WHERE tourism_api_id = ANY($1::text[]) AND category IS DISTINCT FROM 'cafe'`,
      [ids],
    );

    console.log(`\n카탈로그에서 고칠 행 ${rows.length}건`);
    for (const row of rows.slice(0, options.samples)) {
      console.log(`  [${row.destination_region ?? '-'}] ${row.name} : ${row.category} → cafe`);
    }
    if (rows.length > options.samples) console.log(`  … 외 ${rows.length - options.samples}건`);

    if (rows.length === 0) {
      console.log('고칠 행이 없습니다.');
      return;
    }
    if (!options.apply) {
      console.log('\ndry-run 입니다. 실제로 갱신하려면 --apply 를 붙여 다시 실행하세요.');
      return;
    }

    // categoryDetail 별로 묶어 한 번에 갱신한다.
    let updated = 0;
    for (const detail of new Set(cafeIds.values())) {
      const scoped = ids.filter((id) => cafeIds.get(id) === detail);
      const res: unknown = await dataSource.query(
        `UPDATE place_embeddings
         SET category = 'cafe', category_detail = $2, updated_at = NOW()
         WHERE tourism_api_id = ANY($1::text[]) AND category IS DISTINCT FROM 'cafe'`,
        [scoped, detail],
      );
      const affected = Array.isArray(res) ? Number(res[1] ?? 0) : 0;
      updated += affected;
      console.log(`  category_detail='${detail}' ${affected}건`);
    }
    console.log(`\n갱신 완료 ${updated}건`);
    console.log('이어서 `pnpm reembed:places -- --apply` 로 임베딩 텍스트를 맞추세요.');
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
