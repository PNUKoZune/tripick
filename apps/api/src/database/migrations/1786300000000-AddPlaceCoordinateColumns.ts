import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 앵커 반경 검색용 위경도 생성 컬럼 + 복합 btree 인덱스.
 *
 * ## 왜 필요한가
 *
 * 행정구역으로 안 잡히는 목적지('광안리'·'남이섬')는 지역 코드 등가 비교로 후보가 0건이라,
 * 좌표 앵커 주변을 bbox 로 훑는 경로가 생겼다(`PlaceSearchScope`). 그런데 좌표는 `coordinates`
 * jsonb 안에 있어서 `((coordinates->>'lat')::double precision) BETWEEN …` 은 인덱스를 못 타고
 * 전체 스캔이 된다. 실측(10,333행, 광안리 3km): **26.8ms 전체 스캔 → 0.8ms bitmap 스캔**.
 * 카탈로그는 전국 적재로 계속 커지므로 스캔 비용도 선형으로 따라 오른다.
 *
 * ## 왜 일반 컬럼이 아니라 생성 컬럼인가
 *
 * `coordinates` 를 쓰는 경로가 이미 여럿이라(적재 upsert·근접 중복 판정·좌표 파싱) 값을
 * 손으로 동기화하는 컬럼을 두면 언젠가 어긋난다. 생성 컬럼은 jsonb 가 정본이고 위경도는 항상
 * 그 파생이라 갈릴 수가 없다.
 *
 * ⚠️ 부작용 하나 — 이 컬럼이 생긴 뒤로는 `coordinates.lat/lng` 에 **숫자로 못 읽는 값이 들어오면
 * INSERT 자체가 실패**한다(캐스트가 행 저장 시점에 돈다). 지금 적재 경로는 전부 number 를
 * `JSON.stringify` 하므로 문제가 없고, 오히려 잘못된 좌표가 조용히 쌓이는 걸 막는 쪽이다.
 * 마이그레이션 시점에 기존 10,333행이 모두 통과하는 것도 확인했다.
 *
 * bbox 는 `lat` 범위 + `lng` 범위라 복합 인덱스의 선두 컬럼(lat)만 범위 스캔에 쓰이고 lng 는
 * 인덱스 내 필터로 걸린다 — 그래도 힙 접근이 격감해서 위 수치가 나온다.
 * init.sql(로컬 최초 기동용)에도 같은 정의가 있다.
 */
export class AddPlaceCoordinateColumns1786300000000 implements MigrationInterface {
  name = 'AddPlaceCoordinateColumns1786300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE place_embeddings
         ADD COLUMN IF NOT EXISTS lat double precision
           GENERATED ALWAYS AS ((coordinates->>'lat')::double precision) STORED`,
    );
    await queryRunner.query(
      `ALTER TABLE place_embeddings
         ADD COLUMN IF NOT EXISTS lng double precision
           GENERATED ALWAYS AS ((coordinates->>'lng')::double precision) STORED`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_place_embeddings_lat_lng
         ON place_embeddings (lat, lng)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_place_embeddings_lat_lng`);
    await queryRunner.query(`ALTER TABLE place_embeddings DROP COLUMN IF EXISTS lng`);
    await queryRunner.query(`ALTER TABLE place_embeddings DROP COLUMN IF EXISTS lat`);
  }
}
