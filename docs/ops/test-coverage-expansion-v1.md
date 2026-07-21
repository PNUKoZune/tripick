# API 테스트 커버리지 확장 v1

문서 목적: 커버리지가 비어 있거나 얕던 백엔드 도메인에 유닛·e2e 테스트를 추가하고, 경량 e2e 인프라를 도입한 작업을 고정한다. 기존에 깨져 있던 테스트 1건 수정과 e2e 인증 가드 개선도 함께 정리한다.

기준 브랜치: `test/api-coverage-expansion`
작성일: 2026-07-13
관련 문서: [`docs/overview/product-v1-scope.md`](../overview/product-v1-scope.md) (v1 범위), [`docs/planner/rag-crag-v1.md`](../planner/rag-crag-v1.md) (planner 파이프라인)

## 1. 배경

`develop` 기준으로 planner 계열(agent·constraint·helpers·retrieval)과 embedding·preferences·replanning DTO 정도만 테스트가 있었다. auth·users·friends·inbox·trip-members·itinerary·email·notification·storage 등 다수 서비스는 커버리지가 없었고, main-planner 는 1300여 줄인데 DTO 스펙만 존재했다. 또 planner 서비스 스펙 1건이 소스 변경을 못 따라가 실패 상태였다.

## 2. 범위

포함:

- 순수 로직·서비스 유닛 테스트 (외부 의존성 목킹)
- CRUD·관계 중심 도메인의 e2e 테스트 (실제 Postgres)
- full AppModule 없이 필요한 모듈만 부팅하는 경량 e2e 인프라
- 깨진 planner 스펙 수정, e2e 인증 가드 충실도 개선

제외:

- web·mobile 프런트 테스트
- 기존 full-stack e2e(`travel-ai-planner.e2e-spec.ts`) 수정 — Redis·LLM 전체를 띄우는 통합 테스트이고 `status` 드리프트는 별도 조사 필요
- realtime 게이트웨이, preferences 서비스 CRUD, main-planner 나머지 메서드 (얕게 남음)

## 3. 테스트 전략 — 유닛(repo 목킹) vs e2e

두 방식을 도메인 성격에 맞춰 나눴다.

- **유닛(repo 목킹)**: 서비스를 `new` 로 직접 만들고 repository·외부 클라이언트를 `jest.fn()` 으로 대체. 계산·분기·에러 처리 로직 검증에 적합. DB 불필요, 수 ms.
- **e2e**: 실제 Postgres(`tripick_test`)에 붙여 컨트롤러 → 서비스 → repo → DB 전 구간을 supertest 로 검증. 라우팅·가드·소유권·관계 쿼리를 실제로 확인. CRUD·관계 중심 도메인에 적합.

| 도메인 | 방식 | 이유 |
| --- | --- | --- |
| auth, itinerary, email, notification, storage, vision, planner-helpers, utils, main-planner | 유닛 | 계산·분기·폴백 로직 위주 |
| trips, friends, inbox, trip-members, users | e2e | CRUD·소유권·관계 쿼리 위주 |

## 4. 경량 e2e 인프라

`apps/api/test/e2e/`

- **`global-setup.ts`**: jest globalSetup. 개발 DB(`tripick`)를 오염시키지 않도록 테스트 전용 `tripick_test` 를 없으면 생성한다. 식별자는 화이트리스트 검증 후 `CREATE DATABASE`.
- **`create-e2e-app.ts`**: `createE2EApp({ entities, controllers, providers, overrideGuards })`. full AppModule(Redis·BullMQ·Throttler·LLM) 대신 필요한 엔티티·컨트롤러·프로바이더만 담아 부팅한다.
  - TypeORM `synchronize: true` + `dropSchema: true` — 앱 부팅마다 스키마를 새로 만들어 테스트 간 격리.
  - `main.ts` 의 `ValidationPipe` 설정을 그대로 재현.
  - **`TestAuthGuard`**: `x-test-user-id` 헤더가 가리키는 사용자를 `request.user` 에 주입. UserEntity 가 등록돼 있으면 실제 `JwtStrategy` 처럼 **DB 에서 사용자 행 전체를 로드**한다. (초기에는 `{ id }` 만 넣어 `nickname`·`handle` 에 의존하는 서비스가 500 나던 것을 개선.)
- **`test/jest-e2e.json`**: `globalSetup` 연결. 실행은 `pnpm --filter @tripick/api test:e2e` (Postgres 필요).

## 5. 추가된 테스트

### 유닛

| 대상 | 개수 | 핵심 검증 |
| --- | --- | --- |
| `packages/utils` | 26 | 기상청 nx·ny 격자 변환·역변환, 날짜·시간, haversine 거리, PCP 특수문자열 파싱, base_time 발표 지연 |
| planner helpers | 15 | TMAP/ODsay 정규화 + 키 미설정 폴백, 스케줄 경계 조정, 강수 힌트 |
| notification | 7 | FCM 초기화·발송·no-op, 만료 토큰/실패 흡수 |
| storage | 10 | S3 업로드·URL·keyFromPublicUrl, 미설정 가드 |
| preference-analyzer | 4 | Vision 태그 파싱, 과반 임계치 집계 |
| alternative | 3 | 재계획 워커 completed/failed 푸시 + rethrow |
| auth | 24 | 이메일 가입·로그인 분기, refresh 회전·재사용 감지·family 폐기, 비밀번호 재설정, 카카오 status |
| itinerary | 6 | 소유권 404/403, replaceTripItems 삭제→저장 순서·Date 변환 |
| email | 6 | console/smtp 모드, 템플릿 메일 링크·HTML 이스케이프 |
| main-planner | 8 | createTrip 검증 6종, 기본 기상/취침·이동수단·노트 병합 배선 |

### e2e

| 대상 | 개수 | 핵심 검증 |
| --- | --- | --- |
| trips | 11 | CRUD + 소유권(403)·부재(404)·날짜/시간 검증(400), 일정 생성 PlannerService 스텁 |
| friends | 9 | 등록 사용자 추가 시 양방향(pending + incoming), 미등록 직접 accepted, 수락 양쪽 승격, 중복 409, pin, 소유권 |
| inbox | 6 | 알림+친구요청 병합·unreadCount, 읽음 처리(404/403), 전체 읽음 |
| trip-members | 11 | owner 멤버 자동 생성, 동행자 추가·수정·삭제, owner 삭제 거부, 취향 조율 |
| users | 12 | 민감 컬럼 제외, 닉네임·핸들 검증(400/409), 알림설정·FCM, 이미지 미설정 503, 탈퇴 |

## 6. 부수 수정

- **planner 스펙 수정** (`test/planner/planner.service.spec.ts`): `toStore` 매핑이 `memo` 를 의도적으로 저장하지 않도록 바뀌었는데 스펙이 여전히 `stored[0].memo` 를 단언해 실패하고 있었다. 재구성(폴백) 경로 실행을 `constraintEngine.validate` 호출 횟수(2회 이상)로 검증하고, memo 미저장을 명시적으로 단언하도록 수정.
- **e2e 인증 가드 개선**: 4절 참고. FriendsService 가 `owner.nickname` 에 의존해 스텁 사용자로 500 나던 문제를 계기로, 가드가 UserEntity 전체를 로드하도록 변경.

## 7. 결과

- 유닛: **118 통과** (20 suites) — `pnpm --filter @tripick/api test`
- 스코프 e2e: **49 통과** (5 suites) — `pnpm --filter @tripick/api test:e2e` (Postgres 필요)
- 타입체크: clean (`tsc --noEmit`)

## 8. 남은 일

- 기존 `travel-ai-planner.e2e-spec.ts` 의 `status: upcoming vs done` 실패 조사 (main-planner status 드리프트 의심)
- realtime 게이트웨이 인증/인가 e2e, preferences 서비스 CRUD, main-planner 나머지 메서드(swap·reorder·alternatives 등) 커버리지
