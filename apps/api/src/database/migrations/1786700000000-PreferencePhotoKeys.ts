import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 취향 사진의 식별자를 **공개 URL → 스토리지 키**로 바꾼다.
 *
 * 사진이 비공개 버킷으로 옮겨지면서 표시용 URL 이 만료되는 서명 URL 이 됐다 — 매번 값이
 * 달라지므로 식별자로 쓸 수 없다. 정본 식별자를 키로 돌리고, 그 키로 태그 맵을 다시 짠다.
 *
 * 컬럼 이름은 `photoUrls` 로 남긴다(엔티티가 `name: 'photoUrls'` 로 매핑) — 담기는 값만
 * 바뀌므로 rename 을 하지 않아 이 마이그레이션이 데이터만 건드린다.
 *
 * 바꾸는 것 3개 (모두 jsonb):
 * - `photoUrls`: 배열 값 URL → 키
 * - `photoTags`: **객체 키** URL → 키
 * - `disabledPhotoTags`: 객체 키 URL → 키
 *
 * URL → 키 변환은 `.../public/preferences/...` 뒤를 살려 `preferences/...` 로 만든다.
 * 절대 URL(`https://cdn.tripick.place/public/preferences/…`)과 상대 경로
 * (`/storage/public/preferences/…`) 를 모두 받는다.
 *
 * ⚠️ 오브젝트 자체를 옮기는 건 이 마이그레이션이 아니다 — `pnpm migrate:photo-objects`
 * 스크립트가 공개 버킷에서 비공개 버킷으로 복사·삭제한다. **스크립트를 먼저 돌리고**
 * 이 마이그레이션을 적용해야 그 사이 사진이 안 깨진다(반대 순서면 키는 새 위치를 가리키는데
 * 오브젝트가 아직 옛 위치에 있다).
 */
export class PreferencePhotoKeys1786700000000 implements MigrationInterface {
  name = 'PreferencePhotoKeys1786700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 배열: 각 원소에서 'preferences/...' 부분만 남긴다.
    await queryRunner.query(`
      UPDATE preferences
      SET "photoUrls" = (
        SELECT COALESCE(jsonb_agg(${TO_KEY('elem')}), '[]'::jsonb)
        FROM jsonb_array_elements_text("photoUrls") AS elem
      )
      WHERE "photoUrls" IS NOT NULL AND jsonb_array_length("photoUrls") > 0
    `);

    // 객체 키: URL 키를 스토리지 키로 다시 짠다.
    for (const column of ['photoTags', 'disabledPhotoTags']) {
      await queryRunner.query(`
        UPDATE preferences
        SET "${column}" = (
          SELECT COALESCE(jsonb_object_agg(${TO_KEY('kv.key')}, kv.value), '{}'::jsonb)
          FROM jsonb_each("${column}") AS kv
        )
        WHERE "${column}" IS NOT NULL AND "${column}" <> '{}'::jsonb
      `);
    }
  }

  /**
   * 되돌리기: 키 → 상대경로 공개 URL(`/storage/public/preferences/…`).
   *
   * 절대 URL 이었던 환경(라이브)은 원래 값을 복원하지 못한다 — 도메인 정보가 키에 남아 있지
   * 않기 때문이다. 상대경로는 web 프록시가 처리하므로 어느 환경에서도 동작하는 형태다.
   * 오브젝트도 스크립트로 되돌려야 한다(`--revert`).
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE preferences
      SET "photoUrls" = (
        SELECT COALESCE(jsonb_agg(${TO_URL('elem')}), '[]'::jsonb)
        FROM jsonb_array_elements_text("photoUrls") AS elem
      )
      WHERE "photoUrls" IS NOT NULL AND jsonb_array_length("photoUrls") > 0
    `);

    for (const column of ['photoTags', 'disabledPhotoTags']) {
      await queryRunner.query(`
        UPDATE preferences
        SET "${column}" = (
          SELECT COALESCE(jsonb_object_agg(${TO_URL('kv.key')}, kv.value), '{}'::jsonb)
          FROM jsonb_each("${column}") AS kv
        )
        WHERE "${column}" IS NOT NULL AND "${column}" <> '{}'::jsonb
      `);
    }
  }
}

/**
 * URL(또는 이미 키인 값) → 키. 멱등이다 — 이미 `preferences/` 로 시작하면 그대로 둔다.
 * `public/preferences/` 앞의 모든 것(스킴·호스트·프록시 경로)을 잘라낸다.
 */
function TO_KEY(expr: string): string {
  return `regexp_replace(${expr}, '^.*?public/preferences/', 'preferences/')`;
}

/** 키 → 상대경로 공개 URL. 이미 URL 이면 그대로 둔다. */
function TO_URL(expr: string): string {
  return `CASE WHEN ${expr} LIKE 'preferences/%'
               THEN '/storage/public/' || ${expr}
               ELSE ${expr} END`;
}
