import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `createdAt`·`updatedAt` 을 timestamptz(=timestamp with time zone)로 통일한다.
 *
 * ## 증상 — 방금 온 알림이 "9시간 전"
 *
 * 인박스에서 갓 만들어진 미도착 알림이 9시간(=KST 오프셋) 전으로 표시됐다. DB 에는 09:00
 * (UTC)로 들어가 있는데 API 응답은 `2026-08-27T00:00:00.125Z` 였다.
 *
 * ## 원인 — 쓰기와 읽기가 서로 다른 시간대를 가정했다
 *
 * `@CreateDateColumn()` 은 타입을 안 주면 Postgres 에서 `timestamp without time zone` 으로
 * 잡힌다. 시간대 정보가 없는 값이라:
 *
 * - **쓰기**는 컬럼 기본값 `now()` 라 DB 세션 시간대(UTC)로 저장된다 → 09:00
 * - **읽기**는 pg 드라이버가 그 값을 *Node 프로세스의 로컬 시간대*로 해석해 Date 를 만든다.
 *   서버가 KST 로 돌면 09:00 KST = 00:00Z → 9시간 어긋난 값이 그대로 JSON 에 실린다.
 *
 * 같은 테이블의 `readAt` 은 처음부터 timestamptz 라 멀쩡했다. 즉 서버 TZ 가 UTC 인 환경에선
 * 우연히 맞고, KST 로 돌리는 순간(로컬 개발기가 그렇다) 전 도메인의 상대 시각이 틀어졌다.
 *
 * ## 하는 일
 *
 * 이미 저장된 naive 값은 전부 UTC 로 쓰인 것이므로 `AT TIME ZONE 'UTC'` 로 그 사실을 명시해
 * 변환한다(마이그레이션 실행 시점의 세션 시간대에 결과가 좌우되지 않게). 이미 timestamptz 인
 * 컬럼은 건드리지 않는다 — 그대로 다시 변환하면 오히려 값이 밀린다.
 *
 * down 은 두 컬럼을 다시 naive UTC 로 되돌린다(이 마이그레이션 이전의 모양). 처음부터
 * timestamptz 였던 다른 컬럼(`readAt`·`expiresAt` 등)은 이름이 달라 대상에 들지 않는다.
 */
const TARGET_COLUMNS = ['createdAt', 'updatedAt'];

export class TimestamptzCreatedUpdatedAt1786600000000 implements MigrationInterface {
  name = 'TimestamptzCreatedUpdatedAt1786600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      DECLARE target record;
      BEGIN
        FOR target IN
          SELECT table_name, column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND data_type = 'timestamp without time zone'
            AND column_name IN (${TARGET_COLUMNS.map((name) => `'${name}'`).join(', ')})
        LOOP
          EXECUTE format(
            'ALTER TABLE %I ALTER COLUMN %I TYPE timestamptz USING %I AT TIME ZONE ''UTC''',
            target.table_name, target.column_name, target.column_name
          );
        END LOOP;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      DECLARE target record;
      BEGIN
        FOR target IN
          SELECT table_name, column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND data_type = 'timestamp with time zone'
            AND column_name IN (${TARGET_COLUMNS.map((name) => `'${name}'`).join(', ')})
        LOOP
          EXECUTE format(
            'ALTER TABLE %I ALTER COLUMN %I TYPE timestamp USING %I AT TIME ZONE ''UTC''',
            target.table_name, target.column_name, target.column_name
          );
        END LOOP;
      END $$;
    `);
  }
}
