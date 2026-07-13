import { Client } from 'pg';

/**
 * e2e 전역 셋업 — 테스트 전용 데이터베이스를 (없으면) 생성한다.
 *
 * 개발용 DB(`tripick`)를 오염시키지 않도록 별도 `tripick_test` 를 쓴다.
 * 스키마는 각 앱 부팅에서 dropSchema+synchronize 로 매번 새로 만든다.
 * 이미 존재하면 조용히 넘어간다.
 */
export default async function globalSetup(): Promise<void> {
  const adminUrl =
    process.env.TEST_ADMIN_DATABASE_URL ??
    'postgresql://tripick:tripick@localhost:5432/tripick';
  const testDbName = process.env.TEST_DATABASE_NAME ?? 'tripick_test';

  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      testDbName,
    ]);
    if (exists.rowCount === 0) {
      // 식별자는 파라미터 바인딩이 불가하므로 이름을 화이트리스트로 검증한다.
      if (!/^[a-zA-Z0-9_]+$/.test(testDbName)) {
        throw new Error(`Unsafe test database name: ${testDbName}`);
      }
      await client.query(`CREATE DATABASE ${testDbName}`);
    }
  } finally {
    await client.end();
  }
}
