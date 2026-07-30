import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 정규화 이름(`replace(lower(name),' ','')`) 함수 인덱스.
 *
 * 적재가 신규 후보마다 "ID 는 다르지만 같은 장소인 행이 이미 있나"를 이름+좌표로 되묻는다
 * (`PlaceEmbeddingRepository.findSamePlace` — 소스 간 중복 방지). 인덱스가 없으면 매 건이
 * 전체 스캔이라 10,478행에서 11ms 였고, 전국 적재 1회(신규 후보 수천 건)면 수십 초가 스캔에
 * 쓰이며 **카탈로그 크기에 선형으로 악화**된다. 좌표 조건은 선택도가 낮아 이름만 인덱스로 좁힌다.
 *
 * 인덱스 식은 질의 식과 **문자까지 같아야** 계획기가 쓴다 — 한쪽을 고치면 다른 쪽도 고쳐야 한다.
 * init.sql(로컬 최초 기동용)에도 같은 인덱스가 있다.
 */
export class PlaceNameLookupIndex1785700000000 implements MigrationInterface {
  name = 'PlaceNameLookupIndex1785700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_place_embeddings_normalized_name
       ON place_embeddings ((replace(lower(name), ' ', '')))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_place_embeddings_normalized_name`);
  }
}
