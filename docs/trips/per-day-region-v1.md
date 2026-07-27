# 여행 일자별 지역 선택 v1

문서 목적: 여행 생성 시 지역 1개만 받아 모든 날에 동일하게 채우던 구조를, 일자별로 지역(하루 여러 지역 허용)을 지정하고 planner 가 각 일차를 그 날 지역 후보로만 채우도록 확장한 작업을 고정한다.

기준 브랜치: `feat/per-day-region` (base: `develop`)
작성일: 2026-07-23
선행 문서: [`docs/trips/trip-create-v1.md`](./trip-create-v1.md) (`/trips/new` 폼 구조), [`docs/trips/destination-tour-api-v1.md`](./destination-tour-api-v1.md) (지역 선택 · 지도 피커), [`docs/planner/rag-crag-v1.md`](../planner/rag-crag-v1.md) (후보 검색 · 배치 파이프라인)
관련 컨텍스트: [`CLAUDE.md`](../../CLAUDE.md) §3 데이터 흐름 · §4 모듈 경계

## 1. 범위

포함:

- 여행 생성 요청에 일자별 지역 계약(`dayRegions: string[][]`) 추가 — 인덱스 i = (i+1)일차, 각 원소는 그 날의 지역 배열(하루 여러 지역)
- 일자별 지역 저장용 `trip_days` 테이블(엔티티) 신설
- planner 일정 생성 분기: 서로 다른 지역이 2개 이상이면 **일자별 지역-스코프 결정적 배치**, 단일 지역이면 **기존 AI 플래너 경로 그대로**
- 생성 폼 UI: "모든 날 같은 지역" 토글 + 일자별 지역 아코디언 입력
- 일수 계산 공용 함수(`countTripDays`) 로 중복 제거

제외:

- 일정/상세 화면에 일차별 지역 라벨을 **표시**하는 기능 — 일정 자체는 이미 날짜별로 맞는 지역으로 채워지므로 입력·저장·배치까지만 (후속, §9)
- 하루 안에서 여러 지역 간 이동 동선 최적화 — 그 날 지역 후보를 한 풀로 합쳐 배치할 뿐, 지역 간 순서를 별도 최적화하지 않음
- React Native 화면 이식

## 2. 데이터 모델 결정

- **하루 여러 지역 허용**. "1일차=부산+기장, 2일차=경주" 같은 입력을 지원한다.
- 저장은 **별도 `trip_days` 테이블**. `trips.destination` 단일 컬럼에 배열을 욱여넣지 않고 정규화한다. `(tripId, day)` 당 여러 행이 생긴다(하루 여러 지역).
- `trips.destination` 은 **대표 지역**(지도 중심·표지 등 표시용)으로 유지한다. 일자별 지역을 쓰면 프론트가 고유 지역을 합친 요약 라벨(`부산 · 경주`)로 채운다. 이 라벨은 **표시 전용**이며 지역 검색 키로 쓰지 않는다(§5.2 폴백 주의).
- 마이그레이션 파일은 만들지 않는다. 이 저장소는 dev `synchronize`(`NODE_ENV=development`) + `autoLoadEntities` 로 스키마를 잡는 관례이므로 엔티티 등록만으로 `trip_days` 가 생성된다.
  - (이후 갱신) 프로덕션은 TypeORM 마이그레이션으로 전환됐다 — `trip_days` 는 초기 마이그레이션(`InitEntities`)에 포함되지만, **이후 엔티티를 바꿀 땐 마이그레이션도 함께 생성**해야 한다([deployment §5-2](../ops/deployment-railway-vercel-runpod.md)). 개발은 여전히 `synchronize` 경로.

[`apps/api/src/trips/trip-day.entity.ts`](../../apps/api/src/trips/trip-day.entity.ts)

- `id`(uuid) · `tripId` · `day`(1-based int) · `region`(string) · `sortOrder`(하루 안 지역 순서)
- `@ManyToOne(() => TripEntity, { onDelete: 'CASCADE' })` — trip 삭제 시 함께 제거. 생성 롤백도 이 CASCADE 로 정리된다(§4).
- `@Index(['tripId', 'day'])`

## 3. 계약 · 타입

[`packages/types/src/main-planner.ts`](../../packages/types/src/main-planner.ts) `CreateTripRequestDto`, [`packages/types/src/trip.ts`](../../packages/types/src/trip.ts) `CreateTripDto` 에 `dayRegions?: string[][]` 추가.

- 생략 시 모든 날을 `destination` 하나로 채운다('모든 날 같은 지역'·기존 데이터 하위호환).
- 있으면 길이는 여행 일수와 같아야 한다.
- `destination` 은 배열을 써도 대표 라벨로 **항상** 채운다.

[`apps/api/src/main-planner/dto/main-planner.dto.ts`](../../apps/api/src/main-planner/dto/main-planner.dto.ts) `CreateTripRequestBodyDto` 는 `@IsOptional() @IsArray() dayRegions`. `string[][]` 내부(각 원소가 배열·문자열인지)는 class-validator 데코레이터로 깔끔히 표현되지 않아 외곽만 막고, 내용 검증은 서비스에서 한다(§4).

## 4. 생성 플로우

[`main-planner.service.ts`](../../apps/api/src/main-planner/main-planner.service.ts) `createTrip` → `assertCreateTrip` → `normalizeDayRegions` → `tripsService.create`.

- **검증(`assertCreateTrip`)**: `dayRegions` 가 있으면
  - 내부 원소가 배열이 아니거나 문자열 아닌 값이 섞이면 → 400 (안 막으면 아래 정규화의 `.map` 이 문자열에 대해 TypeError 를 던져 **500** 이 난다)
  - 길이 ≠ 여행 일수 → 400
  - 어떤 일차든 (trim 후) 지역이 0개 → 400
  - 지역 이름 80자 초과 → 400
- **정규화(`normalizeDayRegions`)**: trim + 빈 값 제거. 모든 날이 결국 **같은 단일 지역**이면 `undefined` 로 접어 단일 지역 흐름을 타게 한다(불필요한 `trip_days` 저장·일자별 분기 회피).
- **저장 순서(`trips.service.ts` `create`)**: trip 저장 → **`trip_days` 저장** → `plannerService.generateItinerary`. 순서가 중요하다 — planner 가 `generateItinerary` 안에서 `trip_days` 를 읽어 각 일차를 채우므로, 일정 생성 전에 반드시 저장돼야 한다. 일정 생성 실패 시 기존처럼 trip 을 삭제 롤백하며, `trip_days` 는 FK CASCADE 로 함께 사라진다.

[`trips.service.ts`](../../apps/api/src/trips/trips.service.ts) · [`trips.module.ts`](../../apps/api/src/trips/trips.module.ts)(`TripDayEntity` forFeature 등록)

## 5. Planner 배치

[`planner.service.ts`](../../apps/api/src/planner/planner.service.ts) `buildAndStoreItinerary`. `generateItinerary`·`replan` 양쪽에서 공통으로 탄다.

### 5.1 단일/일자별 분기

- `resolveDayRegions(trip, dayCount)`: `trip_days` 조회. 미설정 일차는 `trip.destination` 으로 채워 항상 길이 `dayCount` 배열을 반환(하위호환).
- `perDayMode = new Set(dayRegions.flat()).size > 1`
  - **단일 지역**: 기존대로 단일 풀 retrieve + `plannerAgent.plan`(하루 리듬·카테고리 균형을 AI 가 맞춤). **회귀 없음**.
  - **일자별 지역**: `retrievePerDay` 로 일차별 후보 풀을 만들고 `buildPerDayDeterministicPlan` 으로 각 일차를 그 날 후보로만 채운다. AI 플래너는 **쓰지 않는다** — 여러 지역을 한 풀로 넘기면 LLM 이 지역을 섞어 배치할 위험이 있어, "각 일차 = 그 날 지역" 보장을 위해 결정적 배치를 택했다.

### 5.2 일자별 후보 검색 (`retrievePerDay`)

- 일차별로 그 날 지역(들)을 각각 `placeRetrieval.retrieve` 조회 후 `id` 기준 dedupe. **한 일차의 여러 지역은 서로 독립이라 `Promise.all` 로 병렬 조회**하고, 지역 순서대로 병합해 결정성을 유지한다.
- **빈 일차 폴백**: 그 날 지역이 0건이면 여행 내 **다른 실제 지역**으로 채워 빈 일차를 막는다. 대표 `destination`(`부산 · 경주` 결합 라벨)은 지역 검색 키로 쓰지 않는다 — `normalizeDestinationRegion` 이 결합 라벨을 매칭하지 못해 폴백이 무의미해지기 때문.

### 5.3 배치 · 검증 · 재생성

- `buildPerDayDeterministicPlan(poolsByDay, itemsPerDay)`: `day = dayIndex+1` 로 미리 배정. `buildDraft` 가 `item.day` 로 그룹핑하므로 지역 간 섞임이 없다.
- 검증 실패 시 재생성 루프(`rebuildValidDraft`)는 모드에 맞는 배치 생성기(`planFactory`)를 받는다. 일자별은 각 풀을 rotate 해 재시도, 단일은 기존 `buildDeterministicPlan` rotate.
- **must-include**(`enforceMustInclude`): 일자별 모드에서는 누락 필수 장소를 **이미 배치된 후보 중 좌표가 가장 가까운 항목의 일차**에 넣어 엉뚱한 지역 일차에 섞이지 않게 한다. 단일 지역 모드는 기존 라운드로빈 유지. (생성 시엔 must 가 비어 무해하고, 재계획 경로에서 의미가 있다.)

[`planner.module.ts`](../../apps/api/src/planner/planner.module.ts) 에 `TripDayEntity` forFeature 를 등록해 `PlannerService` 가 `TripsService` 의존(순환) 없이 `trip_days` 를 직접 읽는다.

## 6. 프론트 UX

[`trip-create-view.tsx`](../../apps/web/src/views/trip-create/ui/trip-create-view.tsx)

- **"모든 날 같은 지역" 토글**(기본 ON). ON = 기존 단일 지역 입력, OFF = 일자별 입력.
- OFF + 기간 미선택 → "여행 기간을 먼저 선택" 안내. 기간이 정해지면 일수만큼 일차 섹션 렌더.
- **아코디언**(`DayRegionAccordionItem`): 한 번에 한 일차만 펼쳐 편집기(검색·추가·지도)를 보이고, 나머지는 `N일차 · 날짜 + 지역 요약` 한 줄로 접는다. 일수가 길어져도 세로로 카드가 쌓이지 않게 한 결정.
- 제출: ON 이면 `destination` 만, OFF 면 `destination` = 고유 지역 합친 라벨(80자) + `dayRegions`. `canSubmit` 은 OFF 일 때 모든 일차에 지역 ≥1 을 요구.

## 7. 공용화 · 기타

- 여행 일수 계산이 planner(`getDayCount`, KST 오프셋)와 main-planner(`tripDayCount`, UTC)에 중복돼 tz·clamp 가 미묘하게 달랐다. [`packages/utils/src/date.ts`](../../packages/utils/src/date.ts) `countTripDays(startIso, endIso)`(UTC 정수 연산, 당일치기=1 클램프)로 통일하고 두 로컬 구현을 제거했다.

## 8. 검증

- 백엔드 유닛/e2e: `apps/api` 전체 375개 통과. 추가 케이스 —
  - `dayRegions` 검증: 길이 불일치·빈 일차·내부 형태 오류(string[] 오전송·비문자열) → 400, 서로 다른 지역은 정규화되어 `create` 전달, 모든 날 같은 지역은 `dayRegions` 미부착([`main-planner.create-trip.spec.ts`](../../apps/api/test/main-planner/main-planner.create-trip.spec.ts))
  - 일자별 배치: 각 일차를 해당 지역 후보로 채우고 AI 플래너 미호출, 지역별 retrieve 확인([`planner.service.spec.ts`](../../apps/api/test/planner/planner.service.spec.ts))
  - e2e: `trip_days` 엔티티 포함 생성/조회/삭제([`trips.e2e-spec.ts`](../../apps/api/test/trips/trips.e2e-spec.ts))
  - `countTripDays` 단위(당일치기·박수·월경계·클램프)([`packages/utils/test/date.spec.ts`](../../packages/utils/test/date.spec.ts))
- 타입체크: `packages/types`·`packages/utils` 빌드, `apps/api`·`apps/web` `tsc --noEmit` 통과
- lint: 이 저장소는 ESLint 9 vs 구버전 config 불일치로 전역 lint 미실행(기존 상태) — 스킵

## 9. 후속 작업

- 일정/상세 화면에 **일차별 지역 라벨** 노출 (현재는 입력·저장·배치까지만). `trip_days` 를 조회 응답에 실어 헤더/일차 구분선에 표시.
- 미입력 일차 강조(아코디언 접힌 줄의 "지역 선택" 을 빨간 점 등으로).
- 하루 여러 지역일 때 지역 간 이동 동선 최적화(현재는 그 날 후보를 한 풀로 합쳐 배치).

## 10. 변경 파일

```
packages/types/src/main-planner.ts
packages/types/src/trip.ts
packages/utils/src/date.ts
packages/utils/test/date.spec.ts
apps/api/src/trips/trip-day.entity.ts                    (신규)
apps/api/src/trips/trips.module.ts
apps/api/src/trips/trips.service.ts
apps/api/src/main-planner/dto/main-planner.dto.ts
apps/api/src/main-planner/main-planner.service.ts
apps/api/src/planner/planner.module.ts
apps/api/src/planner/planner.service.ts
apps/api/test/main-planner/main-planner.create-trip.spec.ts
apps/api/test/planner/planner.service.spec.ts
apps/api/test/trips/trips.e2e-spec.ts
apps/web/src/views/trip-create/ui/trip-create-view.tsx
```
