import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 소스가 준 카테고리 상세(`category_detail`) 컬럼.
 *
 * ## 왜 필요한가 — 세 가지가 한 컬럼에 묶여 있었다
 *
 * 1. **DB 만 읽어 재임베딩할 수 없었다.** 임베딩 텍스트는 `buildText` 가 만들고 그 안에
 *    `categoryDetail` 이 들어간다. 그 값이 저장되지 않으니 DB 에서 텍스트를 재구성하면 적재
 *    경로와 해시가 어긋나 다음 적재가 전량을 재임베딩한다. 그래서 태그 사전을 한 줄 고칠 때마다
 *    KTO 전량 재적재(회당 ~505콜 · 15분)를 돌려야 했다.
 * 2. **적재 게이트와 검색 게이트가 같은 입력을 못 봤다.** 검색 단계 pgvector 후보에는
 *    categoryDetail 이 없어, 적재 판정이 검색보다 후해지지 않도록 적재에서도 **일부러 빼고**
 *    판정하고 있었다(`place-ingestion.service.ts`). 저장하면 둘이 같은 입력을 본다.
 * 3. **이름 기반 의료 필터의 오탈락**을 가를 근거가 없었다. KTO 는 '부산 구 백제병원'
 *    (등록문화재)을 관광지(12)로, 약국을 쇼핑(38)로 준다. 소스 카테고리를 보면 갈린다.
 *
 * ## 태그도 달라진다
 *
 * `inferPlaceTags` 의 haystack 에 categoryDetail 이 들어간다. 즉 지금까지 **적재 시점과 검색
 * 시점의 태그가 서로 달랐다**(적재는 categoryDetail 을 보고 검색은 못 봤다). 이 컬럼이 그
 * 불일치를 없앤다.
 *
 * 기존 행은 NULL 이라 백필 전까지는 지금과 똑같이 동작한다(NULL → categoryDetail 없음).
 * 백필은 재적재 1회로 되고, 그 뒤부터 태그 사전 수정은 `reembed:places` 로 KTO 없이 돈다.
 */
export class AddPlaceCategoryDetail1786500000000 implements MigrationInterface {
  name = 'AddPlaceCategoryDetail1786500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE place_embeddings ADD COLUMN IF NOT EXISTS category_detail text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE place_embeddings DROP COLUMN IF EXISTS category_detail`);
  }
}
