import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 행사 기간 컬럼 (KTO 축제공연행사, contentTypeId=15).
 *
 * ## 왜 필요한가
 *
 * 축제는 **장소가 아니라 기간이 있는 이벤트**인데 카탈로그가 그걸 몰랐다. 실측(부산 적재 후)에서
 * `2025 영호남 전통시장 박람회`·`크리스마스 빌리지 부산 2025` 처럼 **이미 끝난 행사**가 일반 장소와
 * 똑같이 후보로 올라왔고, `해운대 모래축제` 가 골든셋 busan-beach 상위 16 안에 들어왔다.
 * 부산 한 곳에만 축제 행이 71건이라 전국이면 1,200건 규모가 같은 성질로 들어온다.
 *
 * ## 왜 적재에서 거르지 않고 컬럼을 두나
 *
 * 적재 시점에 "끝난 행사"만 빼면 **오늘 적재한 행사가 다음 달에 그대로 유령이 된다** — 8월에
 * 적재한 8월 축제를 10월 여행 후보로 내주게 된다. 기간이 있는 데이터는 기간을 저장하고
 * **소비 시점(여행 날짜)에 판정**해야 한다.
 *
 * 끝난 행사 행을 지우지도 않는다. 연례 축제는 KTO 가 같은 contentId 의 날짜를 갱신하므로,
 * 지웠다 다시 넣으면 임베딩만 매년 새로 태우게 된다. 검색이 안 보이게 하는 것으로 충분하다.
 *
 * NULL 은 "기간 없음 = 상시"로 읽는다 — 축제가 아닌 행(관광지·음식점)이 전부 여기 해당하므로
 * 기본값이 곧 기존 동작이다.
 */
export class AddPlaceEventPeriod1786400000000 implements MigrationInterface {
  name = 'AddPlaceEventPeriod1786400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE place_embeddings ADD COLUMN IF NOT EXISTS event_start_date date`,
    );
    await queryRunner.query(
      `ALTER TABLE place_embeddings ADD COLUMN IF NOT EXISTS event_end_date date`,
    );
    // 기간 조건은 지역·반경으로 이미 좁혀진 집합에만 걸리므로 인덱스는 두지 않는다.
    // 부분 인덱스가 필요해질 만큼 축제 행이 많아지면(전국 ~1,200건) 그때 재검토.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE place_embeddings DROP COLUMN IF EXISTS event_end_date`);
    await queryRunner.query(`ALTER TABLE place_embeddings DROP COLUMN IF EXISTS event_start_date`);
  }
}
