/**
 * 취향 사진 오브젝트를 **공개 버킷 → 비공개 버킷**으로 옮긴다.
 *
 * 왜 필요한가: 라이브 공개 버킷에는 `cdn.tripick.place` 커스텀 도메인이 붙어 있고, R2 는
 * 프리픽스 단위 접근 정책이 없다 — 즉 키를 아는 사람은 버킷 전체를 읽는다. 개인 취향 사진이
 * 영구 공개 URL 로 열려 있던 상태를 닫는 것이 이 이전의 목적이다.
 *
 * 순서가 중요하다:
 *   1) 이 스크립트 (오브젝트 복사 → 검증 → 원본 삭제)
 *   2) `pnpm migration:run` (DB 의 식별자 URL → 키)
 * 반대로 하면 DB 는 새 위치를 가리키는데 오브젝트가 아직 옛 위치에 있어 사진이 깨진다.
 *
 * 실행:
 *   pnpm --filter @tripick/api migrate:photo-objects            # dry-run (기본)
 *   pnpm --filter @tripick/api migrate:photo-objects -- --apply # 실제 이동
 *   pnpm --filter @tripick/api migrate:photo-objects -- --apply --keep-source  # 원본 보존
 *
 * 되돌리기(비공개 → 공개):
 *   pnpm --filter @tripick/api migrate:photo-objects -- --apply --revert
 *
 * 멱등하다 — 이미 옮겨진 오브젝트는 건너뛴다. 중간에 끊겨도 다시 돌리면 된다.
 */
import 'dotenv/config';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';

const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');
const KEEP_SOURCE = process.argv.includes('--keep-source');

/** 공개 버킷에서의 프리픽스와 비공개 버킷에서의 프리픽스. `public/` 이 떨어진다. */
const PUBLIC_PREFIX = 'public/preferences/';
const PRIVATE_PREFIX = 'preferences/';

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} 가 필요합니다.`);
  return value;
}

async function main(): Promise<void> {
  const client = new S3Client({
    endpoint: env('STORAGE_ENDPOINT'),
    region: 'auto',
    credentials: {
      accessKeyId: env('STORAGE_ACCESS_KEY'),
      secretAccessKey: env('STORAGE_SECRET_KEY'),
    },
    forcePathStyle: true,
  });
  const publicBucket = env('STORAGE_BUCKET');
  const privateBucket = env('STORAGE_PRIVATE_BUCKET');
  if (publicBucket === privateBucket) {
    throw new Error('STORAGE_BUCKET 과 STORAGE_PRIVATE_BUCKET 이 같습니다 — 이전할 것이 없습니다.');
  }

  const from = REVERT
    ? { bucket: privateBucket, prefix: PRIVATE_PREFIX }
    : { bucket: publicBucket, prefix: PUBLIC_PREFIX };
  const to = REVERT
    ? { bucket: publicBucket, prefix: PUBLIC_PREFIX }
    : { bucket: privateBucket, prefix: PRIVATE_PREFIX };

  console.log(
    `${REVERT ? '되돌리기' : '이전'}: ${from.bucket}/${from.prefix} → ${to.bucket}/${to.prefix}` +
      `${APPLY ? '' : '  (dry-run — --apply 로 실제 실행)'}`,
  );

  const keys = await listKeys(client, from.bucket, from.prefix);
  console.log(`대상 ${keys.length}건`);

  let moved = 0;
  let skipped = 0;
  let failed = 0;

  for (const sourceKey of keys) {
    const targetKey = to.prefix + sourceKey.slice(from.prefix.length);

    // 멱등: 목적지에 이미 있으면 복사를 건너뛰고 원본 정리만 판단한다.
    const exists = await headExists(client, to.bucket, targetKey);
    if (exists) {
      skipped += 1;
    } else if (APPLY) {
      try {
        await client.send(
          new CopyObjectCommand({
            Bucket: to.bucket,
            Key: targetKey,
            // CopySource 는 `bucket/key` 형태이고 키는 URL 인코딩이 필요하다.
            CopySource: `${from.bucket}/${encodeURIComponent(sourceKey)}`,
          }),
        );
      } catch (err) {
        failed += 1;
        console.error(`복사 실패 ${sourceKey}: ${(err as Error).message}`);
        continue;
      }
      moved += 1;
    } else {
      moved += 1;
      console.log(`  [dry-run] ${sourceKey} → ${to.bucket}/${targetKey}`);
      continue;
    }

    // 복사가 확인된 뒤에만 원본을 지운다 — 순서가 반대면 실패 시 사진이 사라진다.
    if (APPLY && !KEEP_SOURCE) {
      const copied = await headExists(client, to.bucket, targetKey);
      if (!copied) {
        failed += 1;
        console.error(`검증 실패(목적지에 없음) — 원본 유지: ${sourceKey}`);
        continue;
      }
      await client.send(new DeleteObjectCommand({ Bucket: from.bucket, Key: sourceKey }));
    }
  }

  console.log(
    `완료 — 이동 ${moved}건, 이미 있어 건너뜀 ${skipped}건, 실패 ${failed}건` +
      `${KEEP_SOURCE ? ' (원본 보존)' : ''}`,
  );
  if (!APPLY) {
    console.log('dry-run 이었다. 실제로 옮기려면 --apply 를 붙일 것.');
  } else if (failed === 0) {
    console.log(
      REVERT
        ? '다음: pnpm --filter @tripick/api migration:revert (DB 식별자 키 → URL)'
        : '다음: pnpm --filter @tripick/api migration:run (DB 식별자 URL → 키)',
    );
  } else {
    console.log('실패가 있어 migration:run 을 미룰 것 — 원인을 먼저 확인한다.');
    process.exitCode = 1;
  }
}

async function listKeys(client: S3Client, Bucket: string, Prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let ContinuationToken: string | undefined;
  do {
    const res = await client.send(
      new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken }),
    );
    for (const item of res.Contents ?? []) {
      if (item.Key) keys.push(item.Key);
    }
    ContinuationToken = res.NextContinuationToken;
  } while (ContinuationToken);
  return keys;
}

async function headExists(client: S3Client, Bucket: string, Key: string): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket, Key }));
    return true;
  } catch {
    return false;
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
