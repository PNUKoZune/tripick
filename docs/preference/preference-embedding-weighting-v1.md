# 취향 임베딩 가중치·어휘 확장·사진별 태그 on/off v1

문서 목적: 사진 분석 태그가 임베딩에 **0 기여**하던 문제를 가중치로 되살리고, 취향 어휘를 넓히고, 사용자가 사진별로 특정 태그를 켜고 끌 수 있게 한 작업을 고정한다.

기준 브랜치: `feat/preference-embedding-weighting` (base: `develop`, 분기점 `000bd25`)
작성일: 2026-07-19
선행 문서: 취향 사진 → 태그 실동작 연결·BullMQ 분리는 `feat/vision-taste-tagging` 의 별도 문서에서 다룬다. 본 문서는 **그 위에 얹은 임베딩·어휘·on/off 만** 기록한다.
관련 컨텍스트: [`CLAUDE.md`](../../CLAUDE.md) §3 취향 분석 파이프라인·CRAG, [`docs/preference/place-embedding-and-preference-personalization-v1.md`](./place-embedding-and-preference-personalization-v1.md) (임베딩 개인화 루프), [`docs/preference/embedding-server-separation-v1.md`](./embedding-server-separation-v1.md) (원격 임베딩·해시 폴백)

## 1. 범위

포함:

- 임베딩 텍스트 직렬화를 **토큰 반복 = 비중** 방식으로 전환 (Set 중복 제거 폐기)
- 사진 태그의 한국어 보강 키워드(`TASTE_KEYWORDS`) 추가 — 한국어 위주 장소 텍스트와 겹치도록
- 취향 어휘 확장: FOOD 6→10, MOOD 5→8, ENVIRONMENT 5→9 (총 16→27), 어휘 정본을 `@tripick/types` 로 단일화
- 장소 태깅 사전(`TAG_HINTS`) 확장 및 `산` 오탐 정규식 교정
- 사진별 태그 on/off: `disabledPhotoTags` 컬럼 + 조회/토글 엔드포인트 + 프론트 칩 UI
- 코드리뷰 후속: 분석 중 사진 UI, 확장 어휘의 우천 재계획 반영(`INDOOR_TAGS` 파생), 조회 맵 메모이제이션

제외:

- 사진 → 태그 추출 자체(vision) 와 BullMQ 잡 — 선행 브랜치 소관
- 사진 태그 가중치 상한을 프로필보다 더 올리는 것 — 의도적 보류 (§7)
- 어휘 확장에 맞춘 장소 시드(`SEEDS_BY_REGION`) 보강 — TAG_HINTS 만 확장, 시드는 그대로

## 2. 배경 — 사진 태그가 임베딩에 0 기여였다

작업 전 [`buildPreferenceText`](../../apps/api/src/preferences/preference-text.ts) 는 사진 태그·프로필 테마 토큰을 모아 `new Set()` 으로 중복을 지운 뒤 콤마로 이었다. 두 가지가 겹쳐 사진 신호가 **구조적으로 사라졌다.**

- 사진이 뽑는 태그(`cafe`·`healing`·`beach`)는 프로필 테마 확장 토큰(`cafe_dessert`→`cafe` 등)에도 거의 다 들어 있다. Set 중복 제거가 사진의 표를 프로필 토큰에 흡수시켰다.
- 원격 임베딩(평균 풀링)·해시 폴백(토큰마다 벡터 누적) **양쪽 모두 토큰 등장 횟수가 곧 비중**인데, 중복 제거는 모든 토큰을 1회로 눌러 "두 소스가 같은 태그를 지목했다(합의)" 는 정보까지 버렸다.

즉 사진을 아무리 분석해도 임베딩 벡터는 프로필만으로 만든 것과 사실상 같았다.

## 3. 데이터 흐름

### 3-1. 가중치 직렬화

```
사진 태그(+confidence) ─┐
프로필 테마·페이스·강도·혼잡 ─┤→ 토큰별 비중 누적(Map) → 비중만큼 반복(상한 4) → ", " join → 임베딩
사진 태그 한국어 보강 키워드 ─┘
```

- 토큰을 비중만큼 반복해 내보낸다. 같은 토큰을 여러 소스가 지목하면 비중이 더해진다(합의 보존).
- 사진 태그 비중 = `tasteWeight(confidence)` = `1 + round(confidence×2)` → 0.0/0.5/1.0 = 1/2/3.
- 프로필 토큰 비중 = 1 고정. 한국어 보강 키워드는 태그 본체보다 한 단계 낮게(`max(1, photoWeight−1)`).
- 상한 `MAX_REPEAT = 4` (사진 3 + 프로필 1). 한 태그가 벡터를 독점하지 못하게 자른다.

### 3-2. 사진별 태그 on/off

```
GET  /preference-analyzer/photos/tags   → 사진별 [{tag, enabled}]
PATCH /preference-analyzer/photos/tags  {url, tag, enabled}
  → disabledPhotoTags 갱신 → 남은(꺼지지 않은) 태그로 재집계 → 재임베딩 → 갱신된 view 반환
```

- 분석 결과(`photoTags`)는 **그대로 두고** `disabledPhotoTags`(사진 URL→끈 태그 목록)에만 기록한다. 다시 켜면 원래 값이 살아난다.
- 집계·삭제·토글 세 경로가 공통으로 "살아있는 사진의, 꺼지지 않은 태그"로 재집계하도록 순수 함수([`photo-taste.ts`](../../apps/api/src/preferences/photo-taste.ts))로 뽑았다.

## 4. 설계 판단

1. **Set 중복 제거 → 토큰 반복.** 임베딩 두 경로(평균 풀링·해시 누적)가 모두 등장 횟수를 비중으로 읽으므로, 반복이 가장 단순하고 정확한 가중치 표현이다. 별도 가중 벡터 합성보다 침습이 적다.
2. **사진 비중 ≥ 프로필 비중.** 사진은 표본은 적어도 사용자가 직접 고른 테마보다 구체적 신호라 최소 같거나 크게 잡았다(confidence 0 에서도 1로 프로필과 동률).
3. **어휘 확장은 3축 안에서 값 추가.** 새 축을 만들지 않고 FOOD/MOOD/ENVIRONMENT 안에 값을 늘렸다(분식·고기·해산물·베이커리 / 레트로·트렌디·프리미엄 / 호수·섬·온천·야경). 축을 늘리면 프롬프트·검증·UI 라벨·집계가 전부 흔들린다.
4. **어휘 정본을 `@tripick/types` 로 단일화.** 이전엔 vision 프롬프트·DTO 검증·장소 태깅이 각자 배열을 다시 적어 어휘를 늘릴 때 조용히 뒤처졌다. `FOOD_PREFERENCES` 등 배열 하나를 정본으로 두고 파생 타입(`TasteTagValue`)·`ALL_TASTE_TAGS` 를 제공한다.
5. **`산` 오탐 정규식.** 주소의 `부산·울산·마산·경산` 과 `산업·산책` 이 mountain 으로 잡히던 걸 앞뒤 글자 제한(`/(?<![부울마경])산(?![가-힣])/u`)으로 막았다. 행정명은 뒤에 시/군/구/동/리가 붙어 lookahead 로 걸러진다. 트레이드오프: `롯데산업` 류 오탐은 막지만 `설악산악회` 처럼 뒤가 한글인 산악 표현은 놓친다.
6. **끈 태그는 집계에서만 뺀다.** `disabledPhotoTags` 를 두어 재분석 없이 즉시 재집계·재임베딩. 사진을 지우면 `pruneToPhotos` 로 `photoTags`·`disabledPhotoTags` 를 함께 정리해 유령 키가 남지 않는다.
7. **확장 어휘를 소비처까지.** 어휘만 늘리면 CRAG 실내 판정(`INDOOR_TAGS`)이 옛 5개 태그만 알아 비 오는 날 횟집·온천이 실외로 밀린다. 식음(FOOD 전체)은 실내라 어휘에서 파생하고, mood/environment 실내값만 보강했다.

## 5. 파라미터·제한값

| 값 | 기본 | 위치 |
| --- | --- | --- |
| `PROFILE_WEIGHT` | 1 | preference-text.ts |
| `MAX_REPEAT` | 4 | preference-text.ts |
| `tasteWeight(conf)` | `1 + round(conf×2)` (1~3) | preference-text.ts |
| 취향 어휘 | FOOD 10 / MOOD 8 / ENV 9 = 27 | packages/types/preference.ts |
| `TAG_HINTS` 항목 | 약 90 (기존 14) | place-seeds.ts |
| `INDOOR_TAGS` | FOOD 전체 + cultural·family·trendy·luxury·city·hotspring | crag-evaluator.service.ts |

## 6. 검증

- 대표 케이스 실측(사진 cafe/healing/beach @conf 0.8 + 프로필 테마 2개): 사진 유래 태그 토큰이 임베딩 텍스트의 **32%(11/34)**, 공유 태그 `cafe` 는 상한 4회. 작업 전(Set 중복 제거)엔 동일 케이스에서 사진 순기여가 사실상 0.
- 신규/보강 테스트 스펙:
  - [`preference-text.spec.ts`](../../apps/api/test/preferences/preference-text.spec.ts) — 합의 시 반복, confidence 가중, 프로필 대비 우위, 상한, 정렬
  - [`photo-taste.spec.ts`](../../apps/api/test/preferences/photo-taste.spec.ts) — on/off·재집계·복원·prune
  - [`preference-analyzer.controller.spec.ts`](../../apps/api/test/preference-analyzer/preference-analyzer.controller.spec.ts) — toggle/list 엔드포인트, 소유·태그 검증
  - [`place-seeds.spec.ts`](../../apps/api/test/planner/retrieval/place-seeds.spec.ts) — `산` 지명/오탐, 확장 어휘 태깅
  - [`crag-evaluator.service.spec.ts`](../../apps/api/test/planner/retrieval/crag-evaluator.service.spec.ts) — 새 실내 태그가 우천 재계획에서 우선
- API 전체 304개 통과, `tsc --noEmit` api·web 통과.

## 7. 알려진 한계

- **프로필이 무거운 사용자의 기여도.** 프로필 테마를 많이 고른 사용자는 프로필 토큰 수가 커져 사진 태그 상대 비중이 다시 떨어진다. 상한(4)을 프로필보다 높게 올리면 완화되지만 이번엔 보류했다(사진 신호를 과대평가할 위험).
- **`산` 정규식 잔여.** 뒤에 한글이 붙는 산악 표현(예: 산악회)과 임야 지번(`산 12`)은 정확도가 낮다. §4-5 트레이드오프.
- **`INDOOR_TAGS` 의 mood/environment 는 수동 목록.** FOOD 는 어휘에서 자동 파생되지만 mood/environment 실내값은 손으로 고른다 — 새 값 추가 시 함께 갱신 필요.
- **어휘 확장 vs 장소 커버리지.** `TAG_HINTS` 는 넓혔지만 `SEEDS_BY_REGION` 시드는 그대로라, 새 태그(온천·야경 등)가 붙을 실제 후보는 외부 API 결과에 의존한다.
- **라이브 마이그레이션.** `disabledPhotoTags` 는 형제 jsonb 컬럼처럼 `synchronize`+`default` 에만 의존한다(프로젝트에 마이그레이션 인프라 없음). 라이브 스키마 반영은 별도 결정.

## 8. 변경 파일

핵심:

- [`packages/types/src/preference.ts`](../../packages/types/src/preference.ts) — 어휘 정본화, `TasteTagValue`·`ALL_TASTE_TAGS`·`TogglePhotoTagDto`·`PreferencePhotoTagsDto`
- [`apps/api/src/preferences/preference-text.ts`](../../apps/api/src/preferences/preference-text.ts) — 가중치 직렬화, `TASTE_KEYWORDS`
- [`apps/api/src/preferences/photo-taste.ts`](../../apps/api/src/preferences/photo-taste.ts) — 재집계 순수 함수(신규)
- [`apps/api/src/preferences/preference.entity.ts`](../../apps/api/src/preferences/preference.entity.ts) — `disabledPhotoTags` 컬럼
- [`apps/api/src/preference-analyzer/preference-analyzer.controller.ts`](../../apps/api/src/preference-analyzer/preference-analyzer.controller.ts) — `GET/PATCH photos/tags`
- [`apps/api/src/planner/retrieval/place-seeds.ts`](../../apps/api/src/planner/retrieval/place-seeds.ts) — `TAG_HINTS` 확장·`산` 정규식
- [`apps/api/src/planner/retrieval/crag-evaluator.service.ts`](../../apps/api/src/planner/retrieval/crag-evaluator.service.ts) — `INDOOR_TAGS` 파생

프론트:

- [`apps/web/src/features/preference-setup/ui/preference-setup-form.tsx`](../../apps/web/src/features/preference-setup/ui/preference-setup-form.tsx) — 사진별 태그 칩(on/off·분석 중 표시)
- [`apps/web/src/entities/preferences/api/preferences-api.ts`](../../apps/web/src/entities/preferences/api/preferences-api.ts) — 조회/토글 API
- [`apps/web/src/entities/preferences/model/options.ts`](../../apps/web/src/entities/preferences/model/options.ts) — 신규 태그 라벨
