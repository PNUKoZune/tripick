import { join } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';

// TypeORM CLI 전용 DataSource.
// Nest 런타임은 app.module.ts 의 TypeOrmModule.forRootAsync 를 쓴다 — 이 파일은
// migration:generate / migration:run 등 CLI 명령이 스키마를 읽기 위해서만 사용한다.
// 두 곳의 entities·migrations 경로가 어긋나면 마이그레이션이 유실되므로
// app.module.ts 의 migrations 설정과 반드시 같은 디렉터리를 가리켜야 한다.

loadEnv({ path: join(__dirname, '..', '..', '.env') });

// 기본값을 두지 않는다. CLI 는 스키마를 바꾸는 명령이라, DATABASE_URL 오타·미주입 시
// 조용히 로컬 DB 로 붙어 엉뚱한 DB 를 건드리는 쪽이 즉시 실패하는 쪽보다 훨씬 위험하다.
const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error(
    'DATABASE_URL 이 필요합니다. apps/api/.env 에 설정하거나 명령 앞에 직접 지정하세요.\n' +
      '  예: DATABASE_URL=postgresql://tripick:tripick@localhost:5432/tripick pnpm migration:run',
  );
}

// TypeORM CLI 는 파일에 DataSource export 가 정확히 1개일 것을 요구한다 (default 만 둔다).
export default new DataSource({
  type: 'postgres',
  url,
  // CLI 는 Nest DI 를 거치지 않아 autoLoadEntities 를 쓸 수 없다. glob 으로 직접 수집한다.
  entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
  migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
  migrationsTableName: 'migrations',
});

