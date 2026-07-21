# 관광공사 detailIntro2 영업시간 연동 v1

문서 목적: 장소 영업시간 데이터 부재를 한국관광공사 소개정보조회(`detailIntro2`)로 채우고, 적재·소비·수동 추가·호출량 보호까지 파이프라인 전 구간에 연결한 작업을 고정한다.

기준 브랜치: `feat/tour-api-opening-hours` (base: `develop`)
선행 문서: [`docs/trips/destination-tour-api-v1.md`](./destination-tour-api-v1.md) §6 후속작업 #2, [`docs/planner/rag-crag-v1.md`](../planner/rag-crag-v1.md) (적재·CRAG 파이프라인)
관련 컨텍스트: [`CLAUDE.md`](../../CLAUDE.md) §6 외부 API 연동, Constraint Engine

## 1. 범위

포함:
- 관광 타입별 영업시간 필드 파싱 → `HH:MM-HH:MM` 정규화 파서
- 적재(`ingest:places`) 시 `detailIntro2` 로 영업시간 수집 → `place_embeddings.opening_hours` 저장
- 소비측 연결: 제약 검증·CRAG 가용성 점수·플래너 스케줄 정렬 (기존 코드가 이미 `openingHours` 를 기다리고 있었음)
- 수동 일정 추가(`addItem`) 시 영업시간 보강: DB 재사용 → KTO 이름+좌표 런타임 조회
- KTO 일일 호출량(API별 1000) 초과 감지·조기 중단·실행 예산

제외:
- 카카오 전용 장소(카페·프랜차이즈 다수)의 영업시간 — KTO 미등록이라 확보 불가 (§7 한계)
- 영업시간의 클라이언트 응답 노출(`toPlannerItem`) — 현재 제약 검증·플래너 내부에서만 사용
- 휴무일(`restdate`)·요일별 영업시간 — 단일 범위로만 정규화

## 2. 배경

일정 생성·검증 곳곳이 `item.openingHours`(`'HH:MM-HH:MM'`)를 소비하도록 이미 짜여 있었으나, 실제로 값이 채워지는 건 하드코딩된 [`place-seeds.ts`](../../apps/api/src/planner/retrieval/place-seeds.ts) seed뿐이었다. pgvector·카카오·KTO 에서 적재된 실장소는 전부 비어 있어 소비측 3곳이 모두 "값 없음 → 제약 없음"으로 통과시키고 있었다.

영업시간은 목록 API(`areaBasedList2`)에 없고 **소개정보조회(`detailIntro2`)로만** 온다. data.go.kr 국문관광정보 GW(15101578), 기존 [`destinations.service.ts`](../../apps/api/src/main-planner/destinations.service.ts)·[`tour-api.service.ts`](../../apps/api/src/planner/retrieval/tour-api.service.ts)와 동일한 axios + `ConfigService` 패턴.

## 3. 핵심 발견 — 타입별 필드명이 다름

`detailIntro2` 응답은 `contentTypeId` 마다 필드 구성이 완전히 다르다. 공통 영업시간 필드가 없어 타입별 매핑이 필수다. 실 API 응답으로 확인:

| contentTypeId | 유형 | 영업시간 필드 | 비고 |
| ------------- | ---- | ------------- | ---- |
| 12 | 관광지 | `usetime` | |
| 14 | 문화시설 | `usetimeculture` | |
| 15 | 축제공연행사 | `playtime` | `usetimefestival` 은 이름과 달리 **요금**('무료') |
| 28 | 레포츠 | `usetimeleports` | |
| 38 | 쇼핑 | `opentime` | |
| 39 | 음식점 | `opentimefood` | |
| 25 | 여행코스 | (없음) | `taketime` 은 영업시간이 아니라 소요시간('5시간') |
| 32 | 숙박 | 해당없음 | `checkintime`/`checkouttime` 만. 적재 제외 대상 |

매핑은 [`opening-hours.parser.ts`](../../apps/api/src/planner/retrieval/opening-hours.parser.ts) `OPENING_HOURS_FIELD`.

## 4. 영업시간 파서

[`opening-hours.parser.ts`](../../apps/api/src/planner/retrieval/opening-hours.parser.ts) `parseOpeningHours(raw)` → `'HH:MM-HH:MM' | undefined`

값이 자유 서술이라 실 응답 기준으로 정규화한다. 못 읽으면 `undefined`(잘못 좁혀 멀쩡한 장소를 탈락시키는 것보다 비우는 게 안전 — 소비측이 값 없음을 제약 없음으로 처리).

처리 케이스(전부 실 응답 기반):
- HTML 조각·엔티티·개행 평문화 (`10:00~18:00<br>\n- 12월~2월 …`)
- 요일 접두어 무시 (`화요일~일요일 10:00~19:00`)
- 꼬리 안내문 무시 (`09:00~17:00※ 자세한 사항은…`)
- 브레이크타임·라스트오더·준비시간 흡수 (`10:00~22:00 (15:30~16:30 브레이크타임)`)
- **여러 범위는 가장 넓은 봉투로 합침**: 계절별 운영(`3월~11월 10:00~18:00 / 12월~2월 10:00~17:00`) → `10:00-18:00`. 좁게 잡아 탈락시키는 쪽이 더 나쁘다는 판단(트레이드오프: 겨울 17:00 이후 방문을 통과시킬 수 있음)
- 자정 넘김(`18:00~02:00`)은 소비측 형식이 표현 못 하므로 그날 끝(`23:59`)으로 절단, `24:00`→`23:59`
- 시 단위 폴백(`9시~18시`), 한 자리 시각 0채움
- 범위 없이 나열된 시각(미사 시간표 등)은 `undefined`
- `상시/항시/24시간` → `00:00-23:59`. **`연중무휴` 는 제외** — 휴무일 없음(매일 영업)이지 24시간 영업이 아니므로 시간 정보로 오해석하지 않음

## 5. 적재 파이프라인

### 5.1 수집 — TourApiService

[`tour-api.service.ts`](../../apps/api/src/planner/retrieval/tour-api.service.ts) `fetchByArea` 안에서 `attachOpeningHours`:
- `areaBasedList2` 로 목록을 다 모은 뒤, 영업시간 필드가 정의된 타입 + `tourismApiId` 있는 것만 대상으로 장소당 `detailIntro2` 1건 조회
- 동시성 제한(`KTO_INTRO_CONCURRENCY`, 기본 4), 개별 실패는 삼켜 적재 계속
- 스위치 `KTO_FETCH_OPENING_HOURS`(기본 true)로 끄고 적재 가능

### 5.2 저장 — 스키마·저장소

- [`init.sql`](../../infra/postgres/init.sql): `place_embeddings.opening_hours TEXT` 컬럼 (신규 테이블 + 기존 볼륨 `ALTER … IF NOT EXISTS` 둘 다)
- [`place-embedding.repository.ts`](../../apps/api/src/planner/retrieval/place-embedding.repository.ts): INSERT/UPDATE/SELECT 에 `opening_hours` 반영, `toCandidate` 로 후보에 실어 소비측까지 전달
- 증분 적재 대응: 영업시간은 임베딩 텍스트 밖이라 텍스트 해시가 같으면 재임베딩을 건너뛰어 값이 안 채워진다. 해시 동일(unchanged) 행은 `updateOpeningHours` 로 영업시간만 backfill

### 5.3 소비측 (기존 코드, 값만 흐르게 됨)

- [`constraint.engine.ts`](../../apps/api/src/planner/constraint/constraint.engine.ts) `checkOpeningHours` — 영업시간 외 방문 검증
- [`crag-evaluator.service.ts`](../../apps/api/src/planner/retrieval/crag-evaluator.service.ts) `availabilityScore` — 목표 시각 개점 여부 가용성 점수
- [`planner.service.ts`](../../apps/api/src/planner/planner.service.ts) `alignToOpeningHours` — 개장 시각으로 스케줄 정렬

## 6. 수동 추가 장소 보강 — addItem

[`main-planner.service.ts`](../../apps/api/src/main-planner/main-planner.service.ts) `resolveManualOpeningHours` 폴백 체인:

1. **DB 재사용** — `kakaoPlaceId` 로 `findOpeningHoursByKakaoId`. 적재 카탈로그에 있으면 외부 API 왕복 없이 재사용
2. **KTO 런타임 조회** — miss + 좌표 있으면 `TourApiService.resolveOpeningHours(name, coords)`:
   - `searchKeyword2(name)` 결과를 사용자 좌표와 **250m 반경**으로 대조, 가장 가까운 후보만 채택
   - 이름 검색은 동명·타지점을 함께 주므로(예: '불국사'→경주/서울) 좌표 대조로 오매칭 차단
   - 채택된 `contentId`+`contentTypeId` → `detailIntro2` → §4 파서 재사용
3. 좌표 없는 자유 입력은 오매칭 방지 위해 KTO 조회 생략

blocking 처리(수동 추가는 저빈도 사용자 동작). `TourApiService` 는 [`planner.module.ts`](../../apps/api/src/planner/planner.module.ts)에서 export 하여 `MainPlannerService` 에 주입.

## 7. 일일 호출량 보호

KTO API는 오퍼레이션별 일일 한도 1000. `detailIntro2` 는 장소당 1건이라 전국 풀적재(시도 16 × 최대 100) 1회가 이미 한도를 초과한다. 세 계층으로 처리:

- **초과 감지** `detectKtoQuota(data)` — data.go.kr 은 초과를 HTTP 200 본문으로 준다. 두 형태 판정: 서비스 JSON `header.resultCode=22`(`LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR`) / 게이트웨이 XML(`_type=json` 이어도 XML) `returnReasonCode=22`
- **실행 예산** `KtoCallBudget` (`KTO_DAILY_CALL_BUDGET`, 기본 900) — 적재 1회 실행의 호출 수 캡. `fetchPage`·`fetchOpeningHours` 가 호출 전 차감
- **조기 중단** — 예산 소진·초과 감지 시 `KtoQuotaExceededError` 전파 → 배치 즉시 중단(헛호출 차단). `PlaceIngestionService` 는 남은 지역 스킵, `--append`(페이지 커서)로 다음 실행에 이어받기. 런타임 `resolveOpeningHours` 는 초과를 조용히 `undefined` 처리(사용자 영향 없음)

**한계**: KTO 는 카페·프랜차이즈를 거의 등록 안 한다(예: '스타벅스 강남대로점' 검색 0건). 관광지·개인 음식점 위주로 커버되고, 카카오 전용 장소의 영업시간은 여전히 비어 있다(유일 소스가 KTO라 방식으로 못 넘는 벽).

## 8. 설정 / 환경변수

[`apps/api/.env.example`](../../apps/api/.env.example):

```
KTO_API_KEY=                  # data.go.kr 국문관광정보 GW 인증키 (기상청 키와 공통)
KTO_FETCH_OPENING_HOURS=true  # 적재 시 detailIntro2 영업시간 조회 (장소당 호출 1건 추가)
KTO_INTRO_CONCURRENCY=4       # detailIntro2 동시 조회 수 (1~16)
KTO_DAILY_CALL_BUDGET=900     # 적재 1회 실행 KTO 호출 예산 (일일 한도 1000 보호)
```

## 9. 검증

- **실 API**(서울):
  - 적재 경로 20건 중 16건 영업시간 확보, 전부 `HH:MM-HH:MM` 준수. 없음 4건은 전부 시장(detailIntro2 영업시간 자체 없음) — 정상
  - 수동 추가 좌표 대조: '불국사'+경주 → `09:00-18:00`, '불국사'+서울 → `09:00-18:00`(동명 구분), **'불국사'+부산 → 없음(오매칭 거부)**, '스타벅스 강남대로점' → 없음(미등록)
  - 예산: 넉넉(기본 900) → 정상 확보·초과 없음 / 예산 1 → `detailIntro2` 진입 전 조기 중단, 영업시간 0, `quotaExceeded=true`
- **단위 테스트**: 파서 21건, 수동 추가 5건, 호출량(감지 2형태 + 예산) 9건. 전체 218건 통과
- 타입체크 `apps/api tsc --noEmit` 통과
- 참고: 이 저장소는 eslint flat config 미설정으로 lint 스킵

## 10. 변경 파일

```
apps/api/src/planner/retrieval/opening-hours.parser.ts        (신규)
apps/api/src/planner/retrieval/tour-api.service.ts
apps/api/src/planner/retrieval/place-embedding.repository.ts
apps/api/src/planner/retrieval/place-ingestion.service.ts
apps/api/src/planner/retrieval/ingestion.types.ts
apps/api/src/planner/planner.module.ts
apps/api/src/main-planner/main-planner.service.ts
apps/api/.env.example
infra/postgres/init.sql
apps/api/test/planner/retrieval/opening-hours.parser.spec.ts  (신규)
apps/api/test/planner/retrieval/kto-quota.spec.ts             (신규)
apps/api/test/main-planner/main-planner.add-item.spec.ts      (신규)
apps/api/test/main-planner/main-planner.create-trip.spec.ts
```

## 11. 후속 작업 후보

- 영업시간 클라이언트 노출: `toPlannerItem` → `PlannerItineraryItemDto` 에 `openingHours` 추가 (화면 배지)
- 카카오 전용 장소 영업시간: 다른 소스(구글 Places 등) 도입 검토
- backfill 스테일 처리: KTO가 영업시간을 내린 경우 옛 값이 유지됨(현재 "마지막 확보값 유지"). 필요 시 명시적 정리 경로
