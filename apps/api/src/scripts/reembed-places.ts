/**
 * 카탈로그 장소 임베딩을 **KTO·카카오 호출 없이** 다시 만든다.
 *
 * 왜 — 임베딩 텍스트는 `name | categoryDetail | 지역코드 | address | 태그` 이고, 그중 **태그는
 * `inferPlaceTags` 가 이름·주소에서 유추**한다. 즉 태그 사전을 한 줄 고치면 그 규칙에 걸리는
 * 행들의 임베딩이 낡은 값이 되고, 선발(벡터 거리)이 옛 태그를 따른다. 예전엔 이걸 갱신할 유일한
 * 방법이 전량 재적재였다 — 회당 KTO ~505콜 + 15분이라 사전을 실험적으로 손대기가 비쌌다.
 *
 * `category_detail` 컬럼이 생겨서 이제 DB 만으로 적재와 **같은 텍스트**를 만들 수 있다
 * (§1786500000000-AddPlaceCategoryDetail). 텍스트 해시가 바뀐 행만 재임베딩하므로 적재와
 * 해시가 어긋나지 않는다 — 다음 적재가 이 행들을 다시 재임베딩하지 않는다.
 *
 * 실행:
 *   cd apps/api
 *   pnpm reembed:places                     # dry-run — 몇 건이 바뀌는지만 보고
 *   pnpm reembed:places -- --apply
 *   pnpm reembed:places -- --apply --regions=서울,부산
 *
 * 옵션:
 *   --apply          실제로 갱신한다 (기본은 dry-run)
 *   --regions=서울   특정 시도 정본 코드만 (쉼표 구분)
 *   --samples=20     보고할 표본 수 (기본 20)
 */
import 'reflect-metadata';
import { createHash } from 'crypto';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type { Coordinates } from '@tripick/types';
import { PlaceIngestionModule } from '../planner/retrieval/place-ingestion.module';
import { TextEmbeddingService } from '../embedding/text-embedding.service';
import { inferPlaceTags } from '../planner/retrieval/place-seeds';
import { placeRegionCodes } from '../planner/retrieval/region-code';

interface Row {
  id: string;
  name: string;
  category: string | null;
  category_detail: string | null;
  address: string | null;
  destination_region: string | null;
  region_sigungu: string | null;
  text_hash: string | null;
  embedding_model: string | null;
  coordinates: Coordinates | null;
}

interface Options {
  apply: boolean;
  regions: string[];
  samples: number;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { apply: false, regions: [], samples: 20 };
  for (const arg of argv) {
    const [key, rawValue] = arg.replace(/^--/, '').split('=');
    const value = rawValue?.trim();
    if (key === 'apply') options.apply = true;
    else if (key === 'regions' && value) options.regions = value.split(',').map((s) => s.trim()).filter(Boolean);
    else if (key === 'samples' && value) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0) options.samples = Math.floor(parsed);
    }
  }
  return options;
}

/**
 * 적재의 `PlaceIngestionService.buildText` 와 **글자까지 같아야 한다.** 한쪽만 고치면 해시가
 * 갈려 두 경로가 서로의 행을 영영 재임베딩한다.
 */
function buildText(row: Row): string {
  const place = {
    name: row.name,
    category: row.category ?? 'attraction',
    ...(row.category_detail ? { categoryDetail: row.category_detail } : {}),
    address: row.address ?? '',
  };
  const tags = inferPlaceTags(place).join(', ');
  const { regionCode, sigunguCode } = placeRegionCodes(
    row.destination_region,
    row.region_sigungu,
    row.address,
  );
  const regionLabel = [regionCode, sigunguCode].filter(Boolean).join(' ');
  return [
    row.name,
    row.category_detail || row.category,
    regionLabel ? `지역: ${regionLabel}` : '',
    row.address,
    tags ? `태그: ${tags}` : '',
  ]
    .filter(Boolean)
    .join(' | ');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(PlaceIngestionModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const dataSource = app.get(DataSource);
    const embeddings = app.get(TextEmbeddingService);
    const model = app.get(ConfigService).get<string>('LLM_EMBEDDING_MODEL', 'text-embedding-model');

    // 해시 폴백으로 카탈로그를 오염시키지 않는다 (적재 스크립트와 같은 안전장치).
    const probe = await embeddings.embedWithSource('임베딩 소스 확인');
    if (probe.source !== 'remote') {
      throw new Error(
        `임베딩 서버가 실제 벡터를 주지 않습니다(source=${probe.source}). 해시 폴백으로 재임베딩하면 검색 품질이 오염됩니다.`,
      );
    }
    console.log(`임베딩 소스=remote 차원=${probe.remoteDimensions ?? probe.vector.length} 모델=${model}`);

    const where = options.regions.length > 0 ? 'WHERE region_code = ANY($1::text[])' : '';
    const rows: Row[] = await dataSource.query(
      `SELECT id, name, category, category_detail, address, destination_region, region_sigungu,
              text_hash, embedding_model, coordinates
       FROM place_embeddings ${where}`,
      options.regions.length > 0 ? [options.regions] : [],
    );

    // ⚠️ `category_detail` 이 NULL 인 행은 **건드리면 안 된다.** 그 행의 저장된 텍스트는 적재
    // 당시의 categoryDetail 을 포함해 만들어졌는데 우리는 그 값을 모른다. 여기서 detail 없이
    // 텍스트를 재구성하면 (a) 해시가 달라 전부 stale 로 보이고 (b) 더 빈약한 텍스트로 덮어써
    // 검색 품질을 떨어뜨리며 (c) 다음 적재가 그 행들을 또 재임베딩한다.
    // 백필(`ingest:places`)을 먼저 돌려 컬럼을 채운 뒤에 이 스크립트를 쓴다.
    const unbackfilled = rows.filter((row) => row.category_detail === null);
    const ready = rows.filter((row) => row.category_detail !== null);
    if (unbackfilled.length > 0) {
      console.log(
        `\n⚠️ category_detail 이 비어 있는 ${unbackfilled.length}행은 건너뜁니다 — 저장된 텍스트가` +
          ' 그 값을 포함해 만들어졌으므로 여기서 재구성하면 더 빈약한 텍스트로 덮어씁니다.' +
          '\n   먼저 `pnpm ingest:places -- --sources=tour` 로 백필하세요.',
      );
    }

    const stale = ready.flatMap((row) => {
      const text = buildText(row);
      const hash = createHash('sha256').update(text).digest('hex');
      if (hash === row.text_hash && row.embedding_model === model) return [];
      return [{ row, text, hash }];
    });

    console.log(`\n대상 ${ready.length}행 중 텍스트·모델이 바뀐 행 ${stale.length}건`);
    for (const { row, text } of stale.slice(0, options.samples)) {
      console.log(`  ${row.name}\n    → ${text}`);
    }
    if (stale.length > options.samples) console.log(`  … 외 ${stale.length - options.samples}건`);

    if (stale.length === 0) {
      console.log('갱신할 행이 없습니다.');
      return;
    }
    if (!options.apply) {
      console.log('dry-run 입니다. 실제로 갱신하려면 --apply 를 붙여 다시 실행하세요.');
      return;
    }

    let done = 0;
    for (const { row, text, hash } of stale) {
      const vector = await embeddings.embed(text);
      await dataSource.query(
        `UPDATE place_embeddings
         SET embedding = $2::vector, text_hash = $3, embedding_model = $4, updated_at = NOW()
         WHERE id = $1`,
        [row.id, `[${vector.join(',')}]`, hash, model],
      );
      done += 1;
      if (done % 500 === 0) console.log(`  … ${done}/${stale.length}`);
    }
    console.log(`재임베딩 완료 ${done}건`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
