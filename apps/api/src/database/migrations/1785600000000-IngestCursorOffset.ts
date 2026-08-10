import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * append 적재 커서를 페이지 번호(`next_page`)에서 행 오프셋(`next_offset`)으로 바꾼다.
 *
 * 왜 필요한가 — 페이지 번호는 그 실행의 배치 크기(`--max`)에 묶여 있다. KTO 는
 * `pageNo`·`numOfRows` 만 받으므로 page 3 은 `--max=100` 이면 200행부터, `--max=50` 이면
 * 100행부터를 뜻한다. 즉 커서를 쓴 실행과 읽는 실행의 옵션이 다르면 같은 숫자가 다른 구간을
 * 가리켜, 안 읽은 구간을 영구히 건너뛰거나 같은 구간을 계속 되읽는다. 오프셋은 실행 옵션과
 * 무관하게 같은 지점을 가리키고, 페이지 경계로 **내림** 정렬해 쓰므로(tour-api.service.ts)
 * 최악의 경우가 "이미 읽은 구간 재확인"(텍스트 해시 동일 → unchanged)이다.
 *
 * 환산은 옛 기본 배치 100 을 가정한 근사다 — 정확한 배치 크기를 저장한 적이 없어 복원할 수 없고,
 * 내림 방향이라 누락 없이 재확인으로만 끝난다. init.sql(로컬 최초 기동용)에도 같은 교체가 있다.
 */
export class IngestCursorOffset1785600000000 implements MigrationInterface {
  name = 'IngestCursorOffset1785600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE ingest_cursors ADD COLUMN IF NOT EXISTS next_offset INTEGER NOT NULL DEFAULT 0`,
    );
    if (await queryRunner.hasColumn('ingest_cursors', 'next_page')) {
      await queryRunner.query(
        `UPDATE ingest_cursors SET next_offset = GREATEST(0, (next_page - 1) * 100) WHERE next_offset = 0`,
      );
      await queryRunner.query(`ALTER TABLE ingest_cursors DROP COLUMN next_page`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE ingest_cursors ADD COLUMN IF NOT EXISTS next_page INTEGER NOT NULL DEFAULT 1`,
    );
    if (await queryRunner.hasColumn('ingest_cursors', 'next_offset')) {
      await queryRunner.query(
        `UPDATE ingest_cursors SET next_page = GREATEST(1, next_offset / 100 + 1) WHERE next_page = 1`,
      );
      await queryRunner.query(`ALTER TABLE ingest_cursors DROP COLUMN next_offset`);
    }
  }
}
