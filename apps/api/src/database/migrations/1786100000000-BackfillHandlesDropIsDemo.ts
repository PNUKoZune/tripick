import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 두 가지 정리를 한다.
 *
 * 1. **핸들 백필 이전.** `UsersService.onModuleInit` 이 매 기동마다 `handle IS NULL` 을 훑고
 *    있었다. 유니크 인덱스가 부분 인덱스(`WHERE "handle" IS NOT NULL`)라 `IS NULL` 조건은
 *    인덱스를 못 타서 부팅마다 seq scan + row 단위 save 였다. 1회성 작업이므로 여기로 옮긴다.
 *    (신규 계정은 생성 시점에 항상 핸들을 받으므로 이후로는 NULL 이 생기지 않는다.)
 *
 * 2. **`isDemo` 제거.** 인증 없이 세션을 내주던 데모 로그인이 사라지면서 이 값을 켜 주는
 *    코드가 없어졌다. 항상 false 인 컬럼과 그에 딸린 배지를 남겨 두지 않는다.
 */
export class BackfillHandlesDropIsDemo1786100000000 implements MigrationInterface {
  name = 'BackfillHandlesDropIsDemo1786100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 서비스의 slugifyHandle 과 같은 규칙: 이메일 local-part → 닉네임 순으로 뿌리를 잡고
    // 영문 소문자·숫자·밑줄만 남긴 뒤 20자로 자르고, 3자 미만이면 '0' 패딩(빈 값은 'user').
    // 충돌하면 숫자 접미사를 붙여 비어 있는 첫 후보를 쓴다.
    await queryRunner.query(`
      DO $$
      DECLARE
        target RECORD;
        root TEXT;
        candidate TEXT;
        suffix INT;
      BEGIN
        FOR target IN SELECT id, email, nickname FROM users WHERE handle IS NULL LOOP
          root := regexp_replace(lower(coalesce(split_part(target.email, '@', 1), '')), '[^a-z0-9_]', '', 'g');
          IF length(root) = 0 THEN
            root := regexp_replace(lower(coalesce(target.nickname, '')), '[^a-z0-9_]', '', 'g');
          END IF;
          root := left(root, 20);
          IF length(root) = 0 THEN
            root := 'user';
          ELSIF length(root) < 3 THEN
            root := rpad(root, 3, '0');
          END IF;

          candidate := root;
          suffix := 0;
          WHILE EXISTS (SELECT 1 FROM users WHERE handle = candidate) LOOP
            suffix := suffix + 1;
            candidate := left(root, 20 - length(suffix::TEXT)) || suffix::TEXT;
          END LOOP;

          UPDATE users SET handle = candidate WHERE id = target.id;
        END LOOP;
      END $$;
    `);

    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "isDemo"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 백필은 되돌리지 않는다 — 핸들은 친구 식별자라 지우면 관계가 끊긴다.
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "isDemo" boolean NOT NULL DEFAULT false`,
    );
  }
}
