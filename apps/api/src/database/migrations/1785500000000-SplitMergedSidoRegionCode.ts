import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 통합 행정구역 라벨('전남광주통합특별시')로 적재된 행의 `region_code` 를 시군구 접미사로 다시 가른다.
 *
 * 왜 필요한가 — 광주·전남 통합으로 **KTO 시도 목록과 카카오 주소가 모두** `전남광주통합특별시` 를
 * 쓴다. `toSidoCode` 는 접두 매칭이라 이 라벨이 `전남` 별칭에 먼저 걸리고, 그 결과 광주 소재
 * 장소가 전부 `region_code='전남'` 으로 박혔다. 검색은 등가 비교(`region_code = '광주'`)라
 * '광주' 목적지는 후보가 0건이 되어 **조용히 빈다**.
 *
 * 가르는 규칙 (region-code.ts 의 `MERGED_SIDO_LABELS` 와 동일):
 * 광주는 자치구만 있고(동구·서구·남구·북구·광산구) 전남은 자치구가 없다(시·군).
 * → 주소의 시군구 토큰이 '구' 로 끝나면 광주, 그 외('시'·'군')는 전남.
 *
 * 주소 우선순위도 TS 쪽과 같다 — 주소 첫 토큰이 통합 라벨인 행만 손대고, 주소가 이미 개별 시도를
 * 말하는 행(예: 라벨은 통합인데 주소가 '전북특별자치도 남원시')은 그 주소가 정본이라 건드리지 않는다.
 * 주소가 아예 없는 KTO 여행코스 행은 시군구를 알 수 없어 판정 보류(기존 값 유지).
 */
export class SplitMergedSidoRegionCode1785500000000 implements MigrationInterface {
  name = 'SplitMergedSidoRegionCode1785500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE place_embeddings
      SET region_code = CASE
            WHEN split_part(btrim(address), ' ', 2) LIKE '%구' THEN '광주'
            ELSE '전남'
          END
      WHERE btrim(address) LIKE '전남광주%'
        AND split_part(btrim(address), ' ', 2) ~ '(시|군|구)$'
    `);
  }

  /**
   * 되돌리기는 통합 라벨을 접두 매칭했던 옛 동작(전부 '전남')으로 복원한다.
   * 손댄 행 집합이 up 과 동일하므로 다른 지역에는 영향이 없다.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE place_embeddings
      SET region_code = '전남'
      WHERE btrim(address) LIKE '전남광주%'
        AND split_part(btrim(address), ' ', 2) ~ '(시|군|구)$'
    `);
  }
}
