# 관광지 혼잡(집중률) 트리거 알림 스케줄러 v1

문서 목적: 한국관광공사 관광지 집중률(방문자 추이 예측) API를 붙여, 여행 일정의 관광지가 붐빌 것으로 예측되면 사용자에게 "일정을 바꿀까요?" 를 묻는 알림 스케줄러를 추가한 작업을 고정한다. **날씨 알림과 동일하게 자동 재계획이 아니라 알림 → 사용자가 직접 변경** 흐름이다. 같은 브랜치에서 반응형 **웨이팅 기능을 제거**했다(§8).

기준 브랜치: `feat/kto-visitor-forecast` (base: `develop`)
선행 문서: [`docs/alerts/weather-alert-scheduler-v1.md`](./weather-alert-scheduler-v1.md) (동형 스케줄러·미러링 원본), [`docs/trips/destination-tour-api-v1.md`](../trips/destination-tour-api-v1.md) (KTO 지역코드), [`docs/notification/inbox-and-trip-invite-v1.md`](../notification/inbox-and-trip-invite-v1.md) (인박스·푸시)
선행 작업: 여행지 피커를 `areaCode2`→`ldongCode2`(법정동 코드)로 이전(별도 PR). 이 API가 법정동 코드를 쓰므로 그 코드 계열을 재활용한다(§6.1)
관련 컨텍스트: [`CLAUDE.md`](../../CLAUDE.md) §6 외부 API 표(관광지 집중률), §4 모듈 분리 기준, §7 "혼잡도 추천 알림"

## 1. 범위

포함:

- 관광지 집중률을 주기 스캔해 혼잡 예상 일자를 감지하는 BullMQ 반복 잡
- 감지 시 `crowd_alert` 인박스 알림 발송 (푸시 포함)
- 여행 일자당 1회 발송 보장 (중복 억제)
- 일정 항목 주소 → `areaCd`/`signguCd`(법정동 코드) 해석
- 반응형 웨이팅 기능 전체 제거 (§8)

제외:

- **자동 재계획** — 의도적 제외. 재계획 큐를 주입받지 않아 구조적으로 불가능하다
- **집중률의 플래닝 반영** — 의도적 제외. 취향 신호를 흐릴 수 있어 일정 생성/재계획 점수에 넣지 않는다(§4)
- "수락 → 재계획" 진입점 — 날씨 알림과 동일하게 planner 이동까지만, 거기서 재계획은 `manual`(§9)
- React Native 신규 작업 — 기존 푸시 라우팅에 `crowd_alert` case 만 추가

## 2. 배경 — 전달 경로 재사용, 신규는 감지·데이터원

날씨 알림 스케줄러가 이미 "감지 → 인박스/FCM → planner 이동" 경로를 완성해 뒀다. 이번 작업은 그 경로를 그대로 미러링하고, **혼잡 데이터원(집중률 API)과 지역코드 해석만** 새로 붙였다.

- 인박스 카테고리 `crowd_alert` 추가 → 액션 `open-trip`("일정 변경"), 수신 토글은 `replan_ready` 와 공유
- `rn-bridge` 푸시 라우팅에 `crowd_alert` → `/planner?tripId=` case 추가
- `CrowdAlertModule` 은 `WeatherAlertModule` 과 동형(constants·module·processor·service)

## 3. 데이터 흐름

```
[cron 30 3 * * * (KST)] BullMQ repeatable
  → CrowdAlertProcessor
  → CrowdAlertService.scanUpcomingTrips
      → 예측 구간(오늘~+27일) 겹치는 confirmed·in_progress 여행 조회
      → KtoCallBudget(300) 선제 캡
      → 여행별:
          미래 후보일(오늘 이후 + attraction 일정 있는 날)만 추림
          → 후보일 관광지별 1회 조회 (budget 차감):
              item.address → resolveRegionCode(areaCd/signguCd)   # ldongCode2
              → fetchConcentration(tAtsNm)                        # tatsCnctrRatedList
          → 일자별 혼잡 판정(장소 평균×1.2 이상 & 절대 하한 10%)
          → 수신자 조회(여행당 1회, 지연)
          → SET NX 로 (여행,일자) 발송 선점
          → InboxService.create(crowd_alert)  # 인박스 + FCM
[앱] 알림 탭 → /planner?tripId= → 사용자가 직접 일정 변경
```

## 4. 모듈 배치 — 집중률은 플래닝과 분리

[`CLAUDE.md`](../../CLAUDE.md) §4 "독립 Module: 트리거가 Planner 와 다른 것" 기준에 따라 `CrowdAlertModule` 로 분리했다. 트리거가 스케줄이라 일정 생성·수정 경로와 무관하다.

**집중률을 CRAG 스코어링·Constraint 엔진에 넣지 않은 것이 핵심 설계 판단이다.** 기획 초안은 혼잡도를 "시간대 배치 최적화" 요소로 뒀지만, 실제로 넣으면 사용자 취향 기반 추천을 혼잡도가 밀어내 신호를 흐린다. 그래서 집중률은 **추천 알림 경로에서만** 소비하고, 플래닝은 취향·영업시간·이동시간만으로 유지한다.

집중률 조회 서비스(`TatsCnctrRateService`)는 `PlannerModule` 이 provide/export 하고, `CrowdAlertModule` 이 주입받는다(`WeatherHelper` 재사용과 동형).

## 5. 지역코드·혼잡 판정 규칙

### 5.1 지역코드 해석

집중률 API는 `areaCd`(법정동 시도 2자리)·`signguCd`(법정동 시군구 5자리)가 필수인데, 일정 항목엔 코드가 없고 주소·이름만 있다. 그래서:

1. `item.address` 첫 토큰 → 시도명, `parseSigungu` → 시군구명
2. `ldongCode2` 로 만든 이름→코드 색인으로 해석. 시도명은 `regionStem` 으로 정규화("강원특별자치도"→"강원")
3. `tAtsNm`(=`item.name`)로 집중률 조회. 서버 LIKE 매칭이라 응답 중 이름이 **정확히 일치하는 관광지만** 골라 다른 관광지 값이 섞이지 않게 한다

### 5.2 혼잡 판정

관광지 예측 집중률(`cnctrRate`, %)이 다음을 **모두** 만족하는 날을 혼잡으로 본다.

| 조건 | 값 | 이유 |
| ---- | -- | ---- |
| 상대 임계 | 그 관광지 예측기간 평균 × `CROWD_RELATIVE_MULTIPLIER`(1.2) 이상 | 집중률 절대 스케일은 관광지마다 달라 "그 장소 기준 붐비는 날"을 본다 |
| 절대 하한 | `CROWD_MIN_RATE`(10%) 이상 | 평소 한산한 곳이 살짝 오른 것까지 알리지 않는다 |
| 일정 유형 | `attraction` | 집중률 API 자체가 관광지만 제공 |
| 중복 억제 | 미선점 | (여행, 일자)당 1회 |

임계값 1.2 / 10% 는 현장 데이터 캘리브레이션이 필요한 초기값으로 상수에 명시했다.

## 6. 설계 판단 (코드 리뷰에서 교정된 것 포함)

### 6.1 이 API는 `areaCode2` 가 아니라 법정동 코드를 쓴다

초기 전제는 "이 API가 이전 지역코드(`areaCode2`)를 쓴다" 였으나, 스펙 샘플값이 이를 반증했다 — `areaCd=51`(강원), `signguCd=51130`(원주). KTO 고유 `areaCode2` 에서 강원은 `32`이고 `51`은 범위 밖이다. 즉 이 API의 지역코드는 `ldongCode2`(법정동)와 같은 계열이라, 먼저 여행지 피커를 `ldongCode2` 로 옮긴 뒤 그 코드 조달을 재활용했다.

### 6.2 시군구 코드 조합 (3자리 → 5자리)

`ldongCode2` 시군구 code 는 **3자리 지역 부분만**(원주 `130`) 반환하는데, 집중률 API 의 `signguCd` 는 법정동 5자리 전체(`51130`)다. 실 API 스모크로 이 불일치를 잡아, `areaCd + code.padStart(3,'0')` 로 조합하도록 고쳤다.

### 6.3 지역코드 색인 캐시 — 실패 시 리셋 (리뷰 지적)

`ldongCode2` 색인은 메모리 1회 캐시인데, 초기 구현은 **실패한 Promise 를 그대로 캐시**해 한 번 실패(쿼터·일시 오류)하면 프로세스 재시작 전까지 지역 해석이 영구 실패했다. `DestinationsService.getAll` 패턴처럼 `.catch` 에서 캐시를 `null` 로 되돌리고, 빈 색인(전송 오류·키 누락)도 캐시하지 않아 다음 스캔이 재시도하게 했다.

### 6.4 LIKE 절단 방지 (리뷰 지적)

`tAtsNm` 은 서버 LIKE 라 동명 관광지가 함께 잡힌다. `numOfRows=100` 단일 페이지면 대상 관광지의 뒷날짜가 잘려 `mean` 이 왜곡될 수 있어, `numOfRows=300`(한 곳 ~30일 × LIKE 형제 여유)으로 올리고 `totalCount` 초과 시 절단 경고를 남긴다.

### 6.5 호출 예산 선제 캡 (리뷰 지적)

집중률 조회는 관광지당 1콜인데, 초기 구현은 반응형 쿼터 감지(초과 응답 시 중단)만 했다. KTO 일일 한도(1000)를 적재 파이프라인과 나눠 쓰므로, 스캔이 한도를 독점하지 않도록 `KtoCallBudget(CROWD_SCAN_CALL_BUDGET=300)` 로 선제 캡을 걸고 소진 시 남은 여행을 다음 주기로 넘긴다.

### 6.6 미래 후보일만 조회 (리뷰 지적)

초기 구현은 미래일 필터 전에 전 관광지 series 를 선조회해, 알릴 수도 없는 과거일 관광지까지 KTO 를 호출했다. 후보일(미래 + 관광지 일정 있는 날)을 먼저 좁힌 뒤, 거기 실제 등장하는 관광지만 조회한다.

### 6.7 cron 은 KST 고정 (리뷰 지적)

`repeat.tz` 미지정 시 서버 로컬 TZ 로 해석돼 UTC 컨테이너면 9시간 어긋난다. `tz: 'Asia/Seoul'` 을 명시해 `30 3 * * *` 가 KST 03:30 에 돈다. 날짜 판정은 날씨 알림과 동일하게 `getKstParts` + UTC 문자열 산술로 TZ 비의존.

### 6.8 중복 억제·부팅·repeatable

날씨 알림과 동일 패턴을 그대로 미러링했다 — SET NX 발송 선점(재시도 중복 방지), Redis 장애 시 발송 유지(누락보다 중복), 반복 잡 등록을 백그라운드+백오프로 돌려 부팅 미차단, `@nestjs/schedule` 대신 BullMQ repeatable(다중 인스턴스 중복 방지). 상세는 [`weather-alert-scheduler-v1.md`](./weather-alert-scheduler-v1.md) §6 참조.

## 7. 검증

### 실 API 스모크 (KTO 실 응답)

- `resolveRegionCode('강원특별자치도 원주시 …')` → `{ areaCd:'51', signguCd:'51130' }` (코드 조합 검증)
- `fetchConcentration(51, 51130, '간현관광지')` → 26일치, 평균 31.08%
- 없는 관광지(`tAtsNm` 미존재) → `totalCount 0` → `null` (자연 skip)
- 리뷰 수정(numOfRows 300·캐시 리셋) 반영 후 재스모크 동일 결과

### 타입·정적 검사

- `apps/api`·`apps/web` `tsc --noEmit` 통과
- 웨이팅 제거 후 잔여 참조 0 (`apps/mobile` 포함 repo 전체, BullMQ job state `'waiting'` 제외)

## 8. 웨이팅 기능 제거 (반응형 → 선제 전환)

집중률 알림이 "붐빔"을 **선제**로 다루므로, 사용자가 대기 중 수동 신고하던 **반응형 웨이팅**을 제거했다. deviation(경로 이탈)·manual(수동) 재계획은 유지한다.

- **트리거**: `/alternative/waiting` 엔드포인트, `ReplanTrigger` 의 `'waiting'`, `waitingMinutes`(replan DTO·planner·agent·crag·kakao 전 경로) 제거
- **표시 메타**: `ItineraryItem.hasWaiting/waitingMinutes`, `stats.waitingCount`, `PlannerAlternativeResponseDto.waitingMinutes`, `type==='restaurant'` 웨이팅 부여 휴리스틱, FE 칩/통계/메시지 제거
- **정리**: `ChangeScheduleButton` 의 `urgent`(긴급 톤) prop 및 웨이팅 전용 미사용 import, 관련 테스트를 deviation/manual 기준으로 갱신

## 9. 알려진 한계 / 후속 작업

- **"수락 → 재계획" 미배선** — `crowd_alert`·`weather_alert` 모두 알림 탭 시 planner 이동까지만이고, 거기서 재계획은 `manual` 로 나간다. `trigger:'weather'` 는 타입·프롬프트·결과분기까지 준비됐으나 진입점이 없다. 둘을 함께 배선하는 것이 후속 후보
- **임계값 캘리브레이션** — 상대 1.2 / 하한 10% 는 초기값. 실제 발송량을 보고 튜닝 필요
- **이름 매칭 누락** — 저장 title 과 KTO `tAtsNm` 표기가 다르면(부제·괄호) 알림이 조용히 누락될 수 있다. 진단용 `debug` 로그만 남겨 뒀다
- **cron TZ 일관성** — 이번엔 `crowd-alert` 만 `tz:'Asia/Seoul'` 을 명시했다. `weather-alert` 도 같은 잠재 이슈가 있으나 범위 밖으로 뒀다
- **데이터랩 통합 시군구** — `ldongCode2` 데이터셋에 `전남광주통합특별시`(code 12) 같은 통합 항목이 있다. 피커·해석엔 지장 없으나 매칭 예외로 재점검 여지

## 10. 변경 파일

```
apps/api/src/planner/retrieval/tats-cnctr-rate.service.ts   (신규) 집중률 조회 + 지역코드 해석
apps/api/src/crowd-alert/crowd-alert.service.ts             (신규) 스캔·판정·발송
apps/api/src/crowd-alert/crowd-alert.module.ts              (신규) repeatable 등록
apps/api/src/crowd-alert/crowd-alert.processor.ts           (신규) 잡 워커
apps/api/src/crowd-alert/crowd-alert.constants.ts           (신규) cron·임계·예산 상수
apps/api/src/planner/planner.module.ts                      (TatsCnctrRateService provide/export)
apps/api/src/app.module.ts                                  (CrowdAlertModule 등록)
apps/api/src/inbox/inbox.service.ts                         (crowd_alert 액션)
apps/api/src/users/users.service.ts                         (prefersCategory remap)
apps/api/src/users/notification-preferences.constants.ts    (기본 수신값)
packages/types/src/inbox.ts                                 (crowd_alert 카테고리)
packages/types/src/user.ts                                  (기본 수신값)
apps/web/src/views/inbox/ui/inbox-view.tsx                  (혼잡 알림 렌더)
apps/web/src/shared/rn-bridge/rn-bridge.tsx                 (푸시 라우팅)
apps/web/src/features/update-notification-preferences/...   (설정 문구)
+ 웨이팅 제거(§8): alternative.controller·replan DTO·planner/agent/crag/kakao·main-planner·FE 위젯·타입·테스트
```

환경변수 추가 없음 — 기존 `KTO_API_KEY`, `REDIS_HOST`, `REDIS_PORT` 를 그대로 쓴다.
