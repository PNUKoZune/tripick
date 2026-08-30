import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 알림에 `mutedAt` 을 추가한다 — 수신 토글이 꺼져 푸시 없이 인박스에만 남긴 시각.
 *
 * 수신 토글이 인박스 저장까지 막던 동작을 "푸시만 끈다"로 바꾸면서, 끈 카테고리의 알림이
 * 안 읽음 배지를 올리는 문제가 생겼다. 이걸 `readAt` 을 미리 찍어 해결하면 아카이브
 * (읽은 지 30일 삭제)의 시계가 받은 순간부터 돌아 이력이 조용히 짧아진다. 그래서 "읽음"과
 * "배지에서 제외"를 다른 컬럼으로 분리한다.
 *
 * - `readAt`: 사용자가 실제로 읽은 시각. 아카이브 기준은 계속 이것뿐이다.
 * - `mutedAt`: 안 읽었지만 배지에는 넣지 않는다. 안 읽은 알림의 보존 정책을 그대로 받는다.
 *
 * 기존 row 는 전부 NULL 로 시작한다 — 과거 알림은 토글이 켜져 있어야 저장됐으므로
 * muted 인 것이 하나도 없다(백필할 값이 없다).
 */
export class AddNotificationMutedAt1786800000000 implements MigrationInterface {
  name = 'AddNotificationMutedAt1786800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "mutedAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "notifications" DROP COLUMN IF EXISTS "mutedAt"`);
  }
}
