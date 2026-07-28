import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * place_embeddings 지역 pre-filter 용 정본 코드 컬럼(region_code·sigungu_code) + 인덱스.
 *
 * 검색이 `destination_region ILIKE '경상북%'` 로 지역을 좁히던 걸 등가 비교로 바꾸기 위한 것.
 * ILIKE 는 인덱스를 못 타서 후보가 늘면 HNSW post-filter 로 밀려나고, 지역이 선택적일수록
 * 근사 이웃이 통째로 걸러져 결과가 비는 방향으로 조용히 망가진다.
 *
 * 코드 정본은 `apps/api/src/planner/retrieval/region-code.ts` (적재·질의 양쪽이 이 함수로 계산).
 * 아래 백필 SQL 은 그 표를 이미 적재된 행에 한 번 적용하는 것 — 새 시도 별칭이 생기면
 * TS 쪽만 고치면 되고(다음 적재에서 반영), 이 마이그레이션은 손대지 않는다.
 *
 * 예외로 시군구 정규식은 한 번 고쳤다(토큰 끝 앵커 누락 → 세종 44행 오염, 아래 주석 참고).
 * 별칭 변경이 아니라 **규칙 자체가 TS 와 달랐던 버그**라 잘못된 SQL 을 남겨 둘 이유가 없다.
 * 이미 적용된 DB 는 이 파일을 고쳐도 다시 돌지 않으므로 `pnpm rederive:region-codes` 로 보정한다
 * (raw SQL 대신 `placeRegionCodes` 를 그대로 태워 두 경로가 갈릴 여지를 없앤 정리 CLI).
 *
 * init.sql(로컬 최초 기동용)에도 같은 컬럼·인덱스가 들어 있다.
 */
export class AddPlaceRegionCodes1785400000000 implements MigrationInterface {
  name = 'AddPlaceRegionCodes1785400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE place_embeddings ADD COLUMN IF NOT EXISTS region_code TEXT`,
    );
    await queryRunner.query(
      `ALTER TABLE place_embeddings ADD COLUMN IF NOT EXISTS sigungu_code TEXT`,
    );

    // 시도 코드는 주소 첫 토큰이 1순위, 수집 라벨이 2순위다(region-code.ts 와 같은 우선순위).
    // 라벨에는 우리 코드 표에 없는 통합 행정명이 섞여 들어올 수 있고, 그때 실제 소재지와
    // 어긋난 코드가 박히면 그 지역 검색에서 후보가 통째로 사라진다.
    // 별칭 표는 표기가 섞여 있어서다 — 풀네임 '경상북도' / 단축 '경북' / seed 로마자 'gyeongbuk'.
    const SIDO_ALIAS_VALUES = `(VALUES
        ('서울', '서울'), ('seoul', '서울'),
        ('부산', '부산'), ('busan', '부산'),
        ('대구', '대구'), ('daegu', '대구'),
        ('인천', '인천'), ('incheon', '인천'),
        ('광주', '광주'), ('gwangju', '광주'),
        ('대전', '대전'), ('daejeon', '대전'),
        ('울산', '울산'), ('ulsan', '울산'),
        ('세종', '세종'), ('sejong', '세종'),
        ('경기', '경기'), ('gyeonggi', '경기'),
        ('강원', '강원'), ('gangwon', '강원'),
        ('충청북', '충북'), ('충북', '충북'), ('chungbuk', '충북'),
        ('충청남', '충남'), ('충남', '충남'), ('chungnam', '충남'),
        ('전라북', '전북'), ('전북', '전북'), ('jeonbuk', '전북'),
        ('전라남', '전남'), ('전남', '전남'), ('jeonnam', '전남'),
        ('경상북', '경북'), ('경북', '경북'), ('gyeongbuk', '경북'),
        ('경상남', '경남'), ('경남', '경남'), ('gyeongnam', '경남'),
        ('제주', '제주'), ('jeju', '제주')
      ) AS m(prefix, code)`;

    // 1순위: 주소 첫 토큰
    await queryRunner.query(`
      UPDATE place_embeddings p
      SET region_code = m.code
      FROM ${SIDO_ALIAS_VALUES}
      WHERE p.region_code IS NULL
        AND p.address IS NOT NULL
        AND lower(split_part(btrim(p.address), ' ', 1)) LIKE m.prefix || '%'
    `);

    // 2순위: 수집 라벨
    await queryRunner.query(`
      UPDATE place_embeddings p
      SET region_code = m.code
      FROM ${SIDO_ALIAS_VALUES}
      WHERE p.region_code IS NULL
        AND p.destination_region IS NOT NULL
        AND lower(replace(p.destination_region, ' ', '')) LIKE m.prefix || '%'
    `);

    // 시군구도 주소가 1순위 — 첫 토큰(시도)을 건너뛰고 시/군/구로 끝나는 둘째 토큰에서 뽑는다
    // (parseSigungu 와 같은 규칙). region_sigungu 가 생기기 전에 적재된 행은 라벨이 비어 있어
    // 이걸 안 채우면 '경주' 같은 시군구 단위 목적지가 pre-filter 에서 후보를 통째로 잃는다.
    //
    // 토큰 **끝** 앵커(`(\\s|$)`)가 규칙의 일부다 — 없으면 시/군/구 글자가 토큰 중간에만 있어도
    // 잘려 나간다. 시군구 계층이 없는 세종 주소가 그렇게 오염됐다: '세종특별자치시 장군면 …'
    // → '장군' → 접미사 '군' 제거 → `'장'`, '국책연구원3로' → `'국책연'`. 이 컬럼은 등가 비교
    // pre-filter 라 실재하지 않는 코드가 박히면 그 행은 시군구 질의에서 조용히 사라진다.
    // TS 정본(`placeRegionCodes`)은 둘째 토큰이 시/군/구로 **끝날 때만** 시군구로 본다.
    const ADDRESS_SIGUNGU = `(regexp_match(address, '^\\S+\\s+(\\S*[시군구])(\\s|$)'))[1]`;
    await queryRunner.query(`
      UPDATE place_embeddings
      SET sigungu_code = NULLIF(
        regexp_replace(${ADDRESS_SIGUNGU}, '(특별자치시|자치시|시|군|구)$', ''),
        ''
      )
      WHERE sigungu_code IS NULL
        AND address IS NOT NULL
        AND ${ADDRESS_SIGUNGU} IS NOT NULL
    `);

    // 주소가 없거나 형태가 어긋난 행은 시군구 라벨로 폴백.
    await queryRunner.query(`
      UPDATE place_embeddings
      SET sigungu_code = NULLIF(
        regexp_replace(replace(region_sigungu, ' ', ''), '(특별자치시|자치시|시|군|구)$', ''),
        ''
      )
      WHERE sigungu_code IS NULL AND region_sigungu IS NOT NULL
    `);

    // 시도로 안 잡히는 시군구 단위 라벨(seed 카탈로그 슬러그)은 시군구 코드로 본다.
    await queryRunner.query(`
      UPDATE place_embeddings
      SET sigungu_code = '경주'
      WHERE sigungu_code IS NULL AND lower(destination_region) = 'gyeongju'
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_place_embeddings_region_code ON place_embeddings (region_code)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_place_embeddings_sigungu_code ON place_embeddings (sigungu_code)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_place_embeddings_sigungu_code`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_place_embeddings_region_code`);
    await queryRunner.query(`ALTER TABLE place_embeddings DROP COLUMN IF EXISTS sigungu_code`);
    await queryRunner.query(`ALTER TABLE place_embeddings DROP COLUMN IF EXISTS region_code`);
  }
}
