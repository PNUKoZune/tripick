/**
 * 취향 사진 오브젝트를 **공개 버킷 → 비공개 버킷**으로 옮긴다.
 *
 * 왜 필요한가: 라이브 공개 버킷에는 `cdn.tripick.place` 커스텀 도메인이 붙어 있고, R2 는
 * 프리픽스 단위 접근 정책이 없다 — 즉 키를 아는 사람은 버킷 전체를 읽는다. 개인 취향 사진이
 * 영구 공개 URL 로 열려 있던 상태를 닫는 것이 이 이전의 목적이다.
 *
 * 라이브에 트래픽이 있으면 **두 번에 걸쳐** 돌린다:
 *
 *   1) `--apply --keep-source`  — 비공개 버킷에 복사하고 **원본은 남긴다.**
 *      구버전 코드가 아직 공개 URL 로 사진을 읽고 있으므로, 여기서 원본을 지우면
 *      배포 전까지 모든 사용자의 사진이 404 로 깨진다
 *   2) (배포) API 부팅 시 `migrationsRun` 이 DB 식별자를 키로 바꾼다
 *   3) `--apply`  — 원본 삭제. **이 단계가 실제로 노출을 닫는다.** 그때까지 사진은 옛
 *      공개 URL 로 계속 열려 있다
 *
 * 트래픽이 없으면 1·3 을 한 번에(`--apply`) 해도 된다. 어느 쪽이든 **DB 마이그레이션보다
 * 복사가 먼저**여야 한다 — 반대면 DB 는 새 위치를 가리키는데 오브젝트가 옛 위치에 있다.
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
  let deleted = 0;
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
      deleted += 1;
    }
  }

  // 원본 삭제 건수를 따로 찍는다. 2회차(이미 복사됨 + 원본 삭제)에서 "건너뜀"만 보이면
  // 파괴적 단계가 아무 일도 안 한 것처럼 읽힌다.
  console.log(
    `완료 — 복사 ${moved}건, 이미 있어 복사 건너뜀 ${skipped}건, ` +
      `원본 삭제 ${deleted}건, 실패 ${failed}건${KEEP_SOURCE ? ' (원본 보존 모드)' : ''}`,
  );
  if (KEEP_SOURCE) {
    console.log(
      '⚠️ 원본이 공개 버킷에 남아 있다 — 배포 후 --keep-source 없이 다시 돌려야 노출이 닫힌다.',
    );
  }
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
