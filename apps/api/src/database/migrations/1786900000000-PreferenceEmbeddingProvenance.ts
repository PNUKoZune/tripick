import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 취향 벡터에 모델·출처를 붙인다.
 *
 * 기존 벡터는 어떤 모델로 만들었는지 증명할 수 없으므로 소급 표기하지 않는다. 마이그레이션 뒤
 * `pnpm --filter @tripick/api reembed:preferences` 로 현재 원격 모델에서 다시 생성해야 검색에 쓰인다.
 */
export class PreferenceEmbeddingProvenance1786900000000 implements MigrationInterface {
  name = 'PreferenceEmbeddingProvenance1786900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE preference_embeddings ADD COLUMN IF NOT EXISTS embedding_model TEXT`,
    );
    await queryRunner.query(
      `ALTER TABLE preference_embeddings ADD COLUMN IF NOT EXISTS embedding_source TEXT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE preference_embeddings DROP COLUMN IF EXISTS embedding_source`,
    );
    await queryRunner.query(
      `ALTER TABLE preference_embeddings DROP COLUMN IF EXISTS embedding_model`,
    );
  }
}
