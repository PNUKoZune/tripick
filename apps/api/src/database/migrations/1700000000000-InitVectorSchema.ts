import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * pgvector 확장 + 임베딩 테이블.
 *
 * 이 테이블들은 TypeORM 엔티티로 관리되지 않는다(raw SQL 리포지토리가 직접 다룬다).
 * 따라서 migration:generate 가 만들어주지 못하며, `infra/postgres/init.sql` 을
 * 그대로 옮겨 손으로 유지한다. 두 파일은 항상 같은 내용이어야 한다 —
 * init.sql 은 로컬 docker-compose 최초 기동용, 이 마이그레이션은 그 외 모든 환경용.
 *
 * 엔티티 마이그레이션보다 먼저 실행되어야 하므로(uuid-ossp 확장 의존) 타임스탬프를
 * 의도적으로 낮게(1700000000000) 고정했다.
 */
export class InitVectorSchema1700000000000 implements MigrationInterface {
  name = 'InitVectorSchema1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // 취향 임베딩 : 유저당 1행, RAG 검색 개인화 벡터
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS preference_embeddings (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id     UUID,
        embedding   vector(1024),
        tags_text   TEXT NOT NULL,
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // 기존 볼륨 호환용 컬럼 보강 (init.sql 로 먼저 만들어진 DB 대비)
    await queryRunner.query(
      `ALTER TABLE preference_embeddings ADD COLUMN IF NOT EXISTS user_id UUID`,
    );
    await queryRunner.query(
      `ALTER TABLE preference_embeddings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_preference_embeddings_user
        ON preference_embeddings (user_id)
    `);

    // 장소 임베딩
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS place_embeddings (
        id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        kakao_place_id      TEXT,
        tourism_api_id      TEXT,
        name                TEXT NOT NULL,
        address             TEXT,
        category            TEXT,
        destination_region  TEXT,
        region_sigungu      TEXT,
        coordinates         JSONB,
        image_url           TEXT,
        opening_hours       TEXT,
        embedding           vector(1024),
        text_hash           TEXT,
        embedding_model     TEXT,
        created_at          TIMESTAMPTZ DEFAULT NOW(),
        updated_at          TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    for (const column of [
      'region_sigungu  TEXT',
      'image_url       TEXT',
      'opening_hours   TEXT',
      'text_hash       TEXT',
      'embedding_model TEXT',
      'updated_at      TIMESTAMPTZ DEFAULT NOW()',
    ]) {
      await queryRunner.query(`ALTER TABLE place_embeddings ADD COLUMN IF NOT EXISTS ${column}`);
    }

    // HNSW (코사인) + 조회 보조 인덱스
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_preference_embeddings_hnsw
        ON preference_embeddings USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_place_embeddings_hnsw
        ON place_embeddings USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_place_embeddings_region ON place_embeddings (destination_region)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_place_embeddings_sigungu ON place_embeddings (region_sigungu)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_place_embeddings_region_name ON place_embeddings (destination_region, name)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_place_embeddings_kakao_place_id ON place_embeddings (kakao_place_id)`,
    );

    // 적재 페이지 커서 (append 모드 재개 지점)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ingest_cursors (
        region     TEXT NOT NULL,
        source     TEXT NOT NULL,
        next_page  INTEGER NOT NULL DEFAULT 1,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (region, source)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS ingest_cursors`);
    await queryRunner.query(`DROP TABLE IF EXISTS place_embeddings`);
    await queryRunner.query(`DROP TABLE IF EXISTS preference_embeddings`);
    // 확장은 다른 DB 객체가 의존할 수 있어 되돌리지 않는다.
  }
}
