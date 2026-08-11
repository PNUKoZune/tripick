import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 인증 대기 비밀번호를 계정(`users.pendingPasswordHash`)에서 **인증 토큰**으로 옮긴다.
 *
 * 계정에 대기 칸이 하나뿐이면 같은 이메일로 들어온 여러 가입 신청이 그 칸을 두고 다투고,
 * 어느 규칙을 택하든 "링크를 누른 사람이 신청하지 않은 비밀번호"가 켜질 수 있었다.
 * 먼저 심은 쪽이 이기면 남의 이메일을 선점해 두고 주인이 자기 가입 링크를 누르는 순간
 * 공격자 비밀번호가 활성화되고(계정 선점), 나중 신청이 이기면 주인이 기다리던 링크의
 * 의미가 바뀐다. 토큰마다 자기 신청의 비밀번호를 들고 있으면 누른 링크의 것만 켜진다.
 *
 * 백필: 살아 있는(미소비) 인증 토큰에만 계정의 대기 값을 옮긴다 — 이미 소비됐거나 토큰이
 * 없는 대기 값은 켜 줄 링크가 없어 어차피 죽은 값이고, 해당 사용자는 재설정으로 복구한다.
 */
export class BindPendingPasswordToVerifyToken1786200000000 implements MigrationInterface {
  name = 'BindPendingPasswordToVerifyToken1786200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "email_tokens" ADD COLUMN IF NOT EXISTS "pendingPasswordHash" character varying`,
    );
    // email_tokens."userId" 는 varchar, users.id 는 uuid 라 캐스팅해서 맞춘다.
    await queryRunner.query(`
      UPDATE "email_tokens" t
         SET "pendingPasswordHash" = u."pendingPasswordHash"
        FROM "users" u
       WHERE u.id::text = t."userId"
         AND t.purpose = 'verify_email'
         AND t."consumedAt" IS NULL
         AND u."pendingPasswordHash" IS NOT NULL
    `);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "pendingPasswordHash"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pendingPasswordHash" character varying`,
    );
    // 되돌릴 때는 살아 있는 토큰 중 가장 최근 것의 값을 계정으로 되돌린다(칸이 하나뿐이라 최신만).
    await queryRunner.query(`
      UPDATE "users" u
         SET "pendingPasswordHash" = t."pendingPasswordHash"
        FROM (
          SELECT DISTINCT ON ("userId") "userId", "pendingPasswordHash"
            FROM "email_tokens"
           WHERE purpose = 'verify_email'
             AND "consumedAt" IS NULL
             AND "pendingPasswordHash" IS NOT NULL
           ORDER BY "userId", "createdAt" DESC
        ) t
       WHERE u.id::text = t."userId"
    `);
    await queryRunner.query(
      `ALTER TABLE "email_tokens" DROP COLUMN IF EXISTS "pendingPasswordHash"`,
    );
  }
}
