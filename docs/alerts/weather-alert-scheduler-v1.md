# 날씨 트리거 알림 스케줄러 v1

문서 목적: 비 예보를 감지해 사용자에게 "일정을 바꿀까요?" 를 묻는 알림 스케줄러를 붙인 작업을 고정한다. 자동 재계획이 아니라 **알림 → 사용자가 직접 변경** 흐름이다.

기준 브랜치: `feat/weather-alert-scheduler` (base: `develop`)
작성일: 2026-07-19
선행 문서: [`docs/alerts/weather-forecast-v1.md`](./weather-forecast-v1.md) (단기예보 연동·캐시), [`docs/alerts/mid-term-forecast-v1.md`](./mid-term-forecast-v1.md) (중기예보 확장), [`docs/notification/inbox-and-trip-invite-v1.md`](../notification/inbox-and-trip-invite-v1.md) (인박스·푸시)
관련 컨텍스트: [`CLAUDE.md`](../../CLAUDE.md) §6 기상청 API 주의사항, §4 모듈 분리 기준

## 1. 범위

포함:

- 기상청 예보를 주기 스캔해 비 예보 일자를 감지하는 BullMQ 반복 잡
- 감지 시 `weather_alert` 인박스 알림 발송 (푸시 포함)
- 여행 일자당 1회 발송 보장 (중복 억제)
- 일차별 좌표 기준 예보 판정

제외:

- **자동 재계획** — 의도적 제외. 재계획 큐를 주입받지 않아 구조적으로 불가능하다
- 푸시 탭 시 해당 일차 딥링크 (여행 화면까지만 이동, §8)
- 예보 악화 시 재알림 (§8)
- React Native 신규 작업 — 기존 푸시 라우팅 재사용

## 2. 배경 — 전달 경로는 이미 있었다

작업 시작 시점에 **소비측이 모두 구현돼 있었고 감지 진입점만 없었다.**

- [`inbox.service.ts`](../../apps/api/src/inbox/inbox.service.ts) `actionsForNotification` — `weather_alert` 카테고리 + `open-trip` 액션
- [`rn-bridge.tsx`](../../apps/web/src/shared/rn-bridge/rn-bridge.tsx) — 푸시 탭 시 `weather_alert` → `/planner?tripId=` 라우팅
- [`users.service.ts`](../../apps/api/src/users/users.service.ts) `prefersCategory` — `weather_alert` 수신 토글(`replan_ready` 와 공유)
- [`alternative.processor.ts`](../../apps/api/src/alternative/alternative.processor.ts) — `trigger:'weather'` 분기에 "스케줄러는 아직 없다" 백로그 주석

그래서 이번 작업은 감지·발송만 새로 붙이고 전달 경로는 그대로 썼다.

## 3. 데이터 흐름

```
[cron 10 2,5,8,11,14,17,20,23] BullMQ repeatable
  → WeatherAlertProcessor
  → WeatherAlertService.scanUpcomingTrips
      → 예보 구간(오늘~+10일) 겹치는 confirmed·in_progress 여행 조회
      → 여행별:
          일자별 일정 그룹 → 일차 중심좌표 → latLngToGrid 로 격자 묶기
          → WeatherHelper.getExtendedForecast (격자당 1회)
          → 비 예보 판정(강수 슬롯 ≥2 + attraction 일정 존재)
          → 수신자 조회(여행당 1회, 지연)
          → SET NX 로 (여행,일자) 발송 선점
          → InboxService.create(weather_alert)  # 인박스 + FCM
[앱] 알림 탭 → /planner?tripId= → 사용자가 직접 일정 변경
```

## 4. 모듈 배치

[`CLAUDE.md`](../../CLAUDE.md) §4 "독립 Module: 트리거가 Planner 와 다른 것" 기준에 따라 `WeatherAlertModule` 로 분리했다. 트리거가 스케줄이라 Planner 일정 생성·수정 경로와 무관하다.

`WeatherHelper` 는 `PlannerModule` 이 이미 export 하고 있어 재사용했다 (`main-planner` 도 같은 방식, [`weather-forecast-v1.md`](./weather-forecast-v1.md) §3). Redis 예보 캐시를 공유하므로 스캔이 추가 호출을 거의 늘리지 않는다.

## 5. 알림 판정 규칙

세 조건을 **모두** 만족해야 발송한다.

| 조건 | 값 | 이유 |
| ---- | -- | ---- |
| 강수 슬롯 수 | ≥ `MIN_RAINY_SLOTS`(2) | 새벽 한 슬롯만 걸린 날까지 알리면 피로가 크다 |
| 일정 유형 | `attraction` 포함 | 식당·카페·숙소는 실내, `transport` 는 이동 자체라 비 영향이 작다 |
| 중복 억제 | 미선점 | (여행, 일자)당 1회 |

강수 슬롯 판정([`isRainy`](../../apps/api/src/weather-alert/weather-alert.service.ts)): 강수형태(PTY) > 0 **또는** 강수확률(POP) ≥ `RAIN_PROBABILITY_THRESHOLD`(60).

## 6. 설계 판단 (리뷰에서 교정된 것 포함)

### 6.1 일차별 좌표 — 여행 평균이 아니라

`main-planner` 의 `mapCenter` 는 전체 일정 좌표 평균을 쓰지만, 거기선 지도 중심이라 무해하다. 여기서는 그 좌표가 **비 판정 근거**라 서울→부산 여행이 대구쯤 날씨로 판정되는 문제가 있었다.

일차별 아이템으로 중심을 잡되, `latLngToGrid` 로 격자가 같은 날끼리 묶어 조회 횟수는 유지한다. 실측: 서울→부산 2일 여행에서 격자 2개(`60:127`, `99:75`) 분리 조회 확인.

### 6.2 날짜 판정은 KST 고정

기상청 `fcstDate` 가 KST 기준이라 서버 로컬 TZ 를 쓰면 UTC 컨테이너에서 하루가 밀린다. [`packages/utils/src/date.ts`](../../packages/utils/src/date.ts) `getKstParts` 를 재사용하고, 여행일 순회는 UTC 기준 문자열 산술로 처리해 TZ 비의존으로 만들었다.

`MAX_TRIP_DAYS`(366)는 `endDate` 가 깨진 데이터일 때 루프 발산을 막는 안전장치.

### 6.3 중복 억제 — SET NX 선점 + 날짜 끝까지

두 번 교정했다.

- **순서**: 발송 후 기록 → **발송 전 SET NX 선점**. 발송 도중 실패하면 BullMQ 재시도(`attempts:3`)가 멤버 전원에게 중복 발송하던 경로를 막는다. 발송이 실패해도 선점은 되돌리지 않는다 — 일부 멤버가 이미 받았을 수 있어 재발송보다 미발송을 택했다
- **기간**: 24시간 고정 → **대상 날짜가 KST 로 끝날 때까지**. 24시간이던 시절엔 날짜가 올 때까지 매일 재알림이 나갔다(4일 여행·3일 비 예보 = 3→6→8건 누적). 이제 (여행, 일자)당 1회로 끝나, 사용자가 일정을 바꾸든 그대로 두든 같은 날짜로 다시 오지 않는다

Redis 장애 시엔 선점이 실패해도 `true` 를 반환한다 — **알림 누락보다 중복을 택한 트레이드오프**이며 테스트로 고정했다.

### 6.4 반복 잡 등록이 부팅을 막지 않도록

`onModuleInit` 에서 `queue.add` 를 `await` 하면 **Redis 무응답 시 API 가 통째로 안 뜬다.** `add` 는 예외를 던지지 않고 ioredis 오프라인 큐에 버퍼링되어 영영 resolve 하지 않는데, Nest 가 이를 await 하기 때문이다(초기 구현의 `try/catch` 는 애초에 실행되지 않는 코드였다).

등록을 백그라운드로 돌리고 10초 응답 상한 + 지수 백오프(5초→최대 5분) 무한 재시도로 바꿨다. `isScheduleRegistered` 로 등록 여부를 노출해 헬스체크에서 확인할 수 있다.

### 6.5 `@nestjs/schedule` 대신 BullMQ repeatable

`@nestjs/schedule` 은 인스턴스마다 실행돼 다중 인스턴스에서 알림이 중복된다. BullMQ repeatable 은 Redis 기반이라 한 번만 실행되고, 이미 스택에 있어 의존성 추가가 없다.

cron `10 2,5,8,11,14,17,20,23` 은 기상청 발표(02·05·08·11·14·17·20·23시) 10분 뒤를 노린 것으로, 갱신된 예보를 바로 반영하면서 캐시도 재사용한다.

## 7. 검증

### 실환경 (Postgres·Redis·기상청 실 API)

- 경주 2일 여행: 1·2일차 비 예보 감지 → 알림 2건, 재실행 시 0건(중복 억제)
- 서울→부산 2일 여행: 격자 2개 분리 조회, 1일차 경복궁·2일차 해운대로 정확히 매핑
- 부팅: 죽은 Redis 포트 기준 **수정 전 45초 내 부팅 미완료(exit 124) → 수정 후 정상 기동** + 5·10·20초 백오프 재시도 로그. Redis 정상 시 38ms 기동, repeat 스케줄 1개 유지(재기동해도 중복 등록 없음)
- 스캔 중 BullMQ 워커가 밀린 반복 잡을 동시 실행하는 상황이 우연히 발생 → 두 스캔이 겹쳤고 두 번째가 0건. 실제 동시성에서 SET NX 선점이 동작함을 확인

### 단위 테스트 (21건)

주요 계약: 자동 재계획 미수행, 임계치 미만 미발송, 실내 일정만 있는 날 미발송, KST 날짜 판정, 일차별 좌표 분리 조회, SET NX 선점, 발송 실패 후 재시도 미발송, 일자당 1회 TTL, Redis 장애 시 발송 유지, 수신자 여행당 1회 조회.

**변이 검증**: 새 테스트가 실제로 회귀를 잡는지 확인했다.

| 변이 | 실패 건수 |
| ---- | -------- |
| `NX` 플래그 제거 | 3건 |
| Redis 장애 시 fail-closed 로 반전 | 3건 |
| 수신자를 일자마다 재조회 | 1건 |

전체 239건 통과(`TZ=UTC` 포함), `tsc --noEmit` 통과.

## 8. 알려진 한계 / 후속 작업

- **예보 악화 시 재알림 없음** — 강수확률이 30%→90% 로 나빠져도 같은 날짜로는 다시 알리지 않는다. 선점 키에 확률을 함께 저장해 임계 이상 상승 시에만 갱신하는 방식이 후보
- **일차 딥링크 없음** — 푸시 탭 시 여행 화면까지만 이동한다. payload 에 `day` 는 실려 있으나 `PlannerView` 에 일차 선택 상태를 뚫어야 해서 범위 밖으로 뒀다
- **강수확률 폴백** — POP 부재 시 임계값(60)을 대신 쓰는 경로가 있다. 실 데이터 확인 결과 단기·중기 모두 PTY 와 POP 가 함께 오므로 사실상 도달 불가라 그대로 뒀다
- **수신 토글 공유** — `weather_alert` 는 `replan_ready` 토글로 제어된다(기존 설계). 날씨 알림만 끄고 싶은 사용자는 재계획 알림도 함께 꺼진다
- **알림 발송 수 집계** — 수신 토글로 걸러진 사용자도 발송 건수에 포함된다(`InboxService.create` 가 `null` 반환). 로그 지표에만 영향

## 9. 변경 파일

```
apps/api/src/weather-alert/weather-alert.service.ts        (신규)
apps/api/src/weather-alert/weather-alert.module.ts         (신규)
apps/api/src/weather-alert/weather-alert.processor.ts      (신규)
apps/api/src/weather-alert/weather-alert.constants.ts      (신규)
apps/api/test/weather-alert/weather-alert.service.spec.ts  (신규)
apps/api/src/app.module.ts                                 (WeatherAlertModule 등록)
apps/api/src/inbox/inbox.service.ts                        (액션 라벨 '일정 확인'→'일정 변경')
apps/api/src/alternative/alternative.processor.ts          (스케줄러 부재 백로그 주석 갱신)
```

환경변수 추가 없음 — 기존 `KMA_API_KEY`, `REDIS_HOST`, `REDIS_PORT` 를 그대로 쓴다.
