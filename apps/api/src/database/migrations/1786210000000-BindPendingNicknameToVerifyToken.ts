import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 가입 신청의 닉네임도 인증 토큰에 싣는다 (비밀번호와 같은 이유 —
 * [1786200000000-BindPendingPasswordToVerifyToken] 참고).
 *
 * 계정 닉네임은 첫 가입 신청이 정하는데, 실제 주인은 인증 링크를 누른 신청이다. 둘이
 * 어긋나면 남의 이메일로 먼저 가입해 둔 쪽이 정한 이름을 주인이 그대로 쓰게 된다.
 *
 * 기존 토큰은 NULL 로 둔다 — 지금 계정에 박혀 있는 닉네임이 곧 그 신청의 값이라 백필해도
 * 적용 결과가 같고, 값이 없으면 계정 닉네임을 그대로 유지한다.
 */
export class BindPendingNicknameToVerifyToken1786210000000 implements MigrationInterface {
  name = 'BindPendingNicknameToVerifyToken1786210000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "email_tokens" ADD COLUMN IF NOT EXISTS "pendingNickname" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "email_tokens" DROP COLUMN IF EXISTS "pendingNickname"`);
  }
}
