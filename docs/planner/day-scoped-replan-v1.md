# 일자별 부분 재계획 v1

문서 목적: 여행 전체를 갈아엎던 AI 재계획을 **지정한 일차만 다시 짜도록** 확장한 작업을 고정한다. 대상 일차 외의 일정은 저장된 항목 그대로 남고, 재계획 모달에서 범위를 고른다. 알림(날씨·혼잡·미도착)이 "이 날"을 말하면서 정작 여행 전체를 바꾸던 불일치를 해소한다.

기준 브랜치: `feat/day-scoped-replan` (base: `develop`)
작성일: 2026-07-27
선행 문서: [`docs/alerts/alert-replan-wiring-v1.md`](../alerts/alert-replan-wiring-v1.md) (§8 첫 번째 한계의 후속), [`docs/planner/rag-crag-v1.md`](./rag-crag-v1.md) (후보 검색·CRAG 파이프라인), [`docs/trips/per-day-region-v1.md`](../trips/per-day-region-v1.md) (일자별 지역 = 이 작업이 그대로 얹히는 배치 경로)
관련 컨텍스트: [`CLAUDE.md`](../../CLAUDE.md) §3 재계획 플로우, §7 "추천만, 재계획은 수동" 원칙

## 1. 범위

포함:

- `ReplanRequestDto.targetDays`(1-based, 생략 시 전체) 신설 + DTO 검증
- 대상 일차만 후보 검색·초안 생성·검증하는 플래너 파이프라인 분기
- 대상 일차만 삭제→삽입하는 저장 경로(`ItineraryService.replaceDayItems`)
- 유지되는 일차에 이미 있는 장소를 후보에서 제외(일차 간 중복 배치 방지)
- 재계획 모달의 "재계획 범위" UI(일차 다중 선택 / 전체 일정), 기본값은 보고 있던 일차
- 비-owner 변경 제안 경로의 요약·미리보기·딥링크 일차에 범위 반영

제외:

- **자동 재계획** — 원칙 그대로. 범위가 좁아졌을 뿐 여전히 사용자가 눌러야 돈다
- **항목 단위 재계획** — 한 장소만 바꾸는 건 이미 대안 팝업(swap)이 담당한다([`alternative-place-picker-v1.md`](./alternative-place-picker-v1.md))
- **일차별로 다른 트리거** — 한 요청의 트리거는 하나다. 2일차는 날씨, 3일차는 혼잡 같은 조합은 요청을 나눠야 한다
- 알림에서 온 일차를 사용자 확인 없이 범위로 확정하는 것 — 기본 선택까지만 하고 제출은 사용자가 한다

## 2. 배경 — 배너는 "이 날"인데 재계획은 여행 전체였다

[`alert-replan-wiring-v1.md`](../alerts/alert-replan-wiring-v1.md) §8 이 남긴 첫 번째 한계다. 3일차 혼잡 알림을 눌러도 `PlannerService.replan` 이 `replaceTripItems` 로 **모든 일차를 삭제하고 다시 만든다**. 결과:

- 진행 중 여행에서 이미 다녀온 1·2일차가 통째로 바뀐다
- 재배치되지 않은 항목의 사용자 메모가 사라진다(장소 키가 안 맞으면 보존 로직이 못 잇는다)
- 사용자가 손으로 고쳐둔 다른 날 일정이 날아간다

배너 문구("이 날 혼잡이 예상돼요")와 실제 동작의 간극이 커서, 알림을 눌러도 되는지 사용자가 판단할 수 없었다. 이번 작업은 요청에 **범위**를 실어 그 간극을 없앤다.

## 3. 데이터 흐름

```
[재계획 모달] 범위 선택 (일차 다중 선택 | 전체)
  → POST /alternative/request  { tripId, trigger, targetDays?: number[] , … }
  → ReplanningService.enqueue   (jobId 에 범위 포함 → 다른 일차 요청이 dedup 에 안 먹힘)
  → BullMQ replan job → PlannerService.replan
      ├ resolvePlanDays        : 범위를 1..dayCount 로 정규화 (밖·중복 제거, 없으면 전체)
      ├ findByTrip             : 기존 항목 조회 → 유지 일차(keptItems) 분리
      ├ 후보 검색              : 대상 일차 지역/개수만큼, keptItems 장소는 제외
      ├ 배치                   : AI 플래너는 1..N 으로 계획 → 실제 일차 번호로 복원
      ├ 제약 검증              : 대상 일차 초안만 (일차 간 이동은 원래 검증 대상 아님)
      └ replaceDayItems        : 대상 일차만 삭제→삽입 (한 트랜잭션)
  → 응답: 유지 일차 + 새 일차를 합친 여행 전체 일정
  → AlternativeProcessor: WS push + replan_ready 결과 알림 (기존과 동일)
```

## 4. 설계 판단

### 4.1 AI 플래너에는 "범위를 줄여서" 넘기고 결과를 되돌린다

부분 재계획을 LLM 에 알리는 방법이 두 갈래였다.

| 방법 | 문제 |
| ---- | ---- |
| 프롬프트에 "3일차만 계획하라"를 서술 | `day must be between 1 and dayCount` 하드룰과 충돌하고, 파서의 day 검증·후보 개수 계산(`dayCount * itemsPerDay`)도 전부 전체 기준이라 어긋난다. LLM 이 1·2일차를 같이 뱉으면 조용히 버려진다 |
| `dayCount = 대상 일차 수` 로 넘기고 결과를 실제 일차로 복원 | 프롬프트·파서·후보 수 계산이 전부 그대로. 복원은 인덱스 매핑 한 번 |

**결정: 후자.** [`planner.service.ts`](../../apps/api/src/planner/planner.service.ts) 의 `remapPlanDays` 가 `planDays[day-1]` 로 되돌린다. 전체 재계획이면 매핑이 항등이라 `plan` 을 그대로 통과시킨다(불필요한 복사 없음). 프롬프트에 넘기는 `startDate`/`endDate` 도 대상 일차의 실제 날짜로 좁힌다.

같은 이유로 `buildDraft`·`buildDeterministicPlan` 의 루프를 `1..dayCount` 에서 `planDays` 순회로 바꿨다. 일차 번호가 곧 날짜 오프셋(`startDate + (day-1)`)이라, 실제 일차 번호를 들고 있어야 3일차 항목이 3일차 날짜에 잡힌다.

### 4.2 일자별 지역 판정은 **여행 전체 기준**을 유지한다

`perDayMode`(일자별 지역 풀 + 지역-스코프 결정적 배치)는 `trip_days` 의 지역이 2종 이상인지로 갈린다. 부분 재계획이 한 일차만 볼 때 그 일차의 지역은 당연히 1종이므로, 판정을 대상 일차 기준으로 좁히면 **단일 풀 경로로 떨어진다**. 그 경로는 `trip.destination` 으로 검색하는데 다지역 여행의 destination 은 `부산 · 경주` 같은 결합 라벨이라 지역 검색이 안 된다.

**결정: 판정은 여행 전체 `dayRegions` 로, 검색만 대상 일차 지역으로.** 다지역 여행의 3일차를 다시 짜면 그 날 지역(경주) 후보로만 채워진다.

### 4.3 저장은 대상 일차만 삭제→삽입, 한 트랜잭션

[`ItineraryService.replaceDayItems`](../../apps/api/src/itinerary/itinerary.service.ts) 를 신설했다(`delete({ tripId, day: In(days) })` → `save`). 전체 재계획은 기존 `replaceTripItems` 를 그대로 쓴다.

**결정: 두 메서드를 합치지 않는다.** 전체 삭제를 "1..dayCount 삭제"로 바꾸면, 여행 기간이 줄어들며 남은 `day > dayCount` 고아 항목을 못 지운다. 기존 경로의 의미(여행의 모든 항목 교체)를 그대로 둔다.

삭제와 삽입을 트랜잭션으로 묶은 건, 삽입 중 실패하면 그 일차가 통째로 비기 때문이다. 전체 재계획은 원래도 비-트랜잭션이었지만(실패 시 검증 단계에서 먼저 막힘) 부분 재계획은 "다른 일차는 멀쩡한데 이 날만 사라짐"이 되어 더 나쁘다.

### 4.4 유지되는 일차의 장소는 후보에서 뺀다

전체 재계획은 한 번의 계획 안에서 `seenCandidateIds` 로 중복을 막는다. 부분 재계획은 계획을 새로 만들지 않는 일차가 있어 이 보호가 없다 — 1일차에 이미 있는 광안리 카페가 2일차 후보 상위에 다시 올라오면 같은 여행에 두 번 들어간다.

**결정: `excludeKeptPlaces` 로 검색 결과에서 제거.** 매칭 키는 memo 보존과 같은 규칙(`kakaoPlaceId` 우선, 없으면 이름+좌표 4자리) + 이름 정규화 비교를 함께 본다. 단 **사용자가 "꼭 포함할 장소"로 지정한 후보는 거르지 않는다** — 명시적 요청이 자동 규칙을 이긴다.

### 4.5 응답은 언제나 여행 전체 일정

`PlannerService.replan` 은 유지 일차 + 새로 저장한 일차를 합쳐 `day`·`order` 순으로 돌려준다. WS `replan_result.updatedItems` 를 화면에 그대로 얹는 소비자가 있으면 부분 목록을 받는 순간 나머지 일차를 잃기 때문이다. 현재 웹은 쿼리 무효화로 다시 읽지만, 페이로드 계약을 "여행의 일정"으로 유지하는 쪽이 안전하다.

### 4.6 dedup jobId 에 범위를 넣는다

기존 키는 `${tripId}-${trigger}-${bucket}`(10초 창)이었다. 범위가 생기면 "1일차 재계획 → 곧바로 2일차 재계획"이 **같은 잡으로 합쳐져 두 번째 요청이 조용히 버려진다**. 키에 정렬된 대상 일차를 넣어(`…-2.3-…`) 범위가 다르면 별개 잡이 되게 했다.

[`alert-replan-wiring-v1.md`](../alerts/alert-replan-wiring-v1.md) §8 이 지적한 "트리거별로 갈리는 dedup"의 반대편 문제다. 그쪽(다른 트리거 → 둘 다 실행)은 이번 범위에서 건드리지 않았다.

### 4.7 기본 범위는 "보고 있던 일차"

모달을 열면 `일차 선택` 모드에 현재 일차 하나가 잡혀 있다.

**결정: 전체가 아니라 좁은 쪽을 기본값으로.** 전체 재생성은 되돌릴 수 없고(이전 일정은 삭제된다) 사용자가 의도하지 않았을 때 손실이 크다. 반대 실수(한 일차만 바뀜)는 다시 요청하면 된다. 알림 딥링크(`?day=`)로 들어오면 그 일차가 그대로 기본값이 되어, 배너 문구("이 날")와 실제 범위가 처음으로 일치한다.

1일 여행이면 범위 선택 자체를 감춘다(고를 게 없다).

### 4.8 잘못된 범위는 400 이 아니라 전체로 폴백

`resolvePlanDays` 는 여행 범위 밖·중복·비정수를 걸러내고, 남은 게 없으면 전체 일차를 돌려준다. DTO 는 여행 일수를 모르는 시점이라 `1 이상 정수`까지만 검증하고(상한은 넉넉히 31개), 실제 절단은 여행을 아는 플래너가 한다.

**결정: 폴백.** 잡은 이미 큐에 들어간 뒤라 여기서 던지면 사용자에게는 "재계획 실패" 알림만 남고 아무 일도 안 일어난다. 기존 동작(전체 재계획)으로 떨어지는 편이 낫다.

## 5. 재계획 범위 UI

[`replan-modal.tsx`](../../apps/web/src/features/request-replan/ui/replan-modal.tsx) 최상단에 "재계획 범위" 필드를 추가했다.

- `일차 선택` / `전체 일정` 2분할 토글 + 일차 칩 다중 선택(`aria-pressed`)
- 선택 상태를 문장으로 되읊는다 — "2·3일차만 새로 만들고 나머지 일차는 그대로 둬요"
- 일차를 하나도 안 고르면 제출 버튼이 잠긴다(빈 배열을 "전체"로 해석하지 않는다 — 사용자 의도가 아니다)
- 성공 토스트도 범위를 말한다: "AI가 2·3일차 일정을 다시 짜고 있어요"

비-owner 는 요청이 owner 승인 대기 제안으로 가므로, 제안 요약(`2·3일차 AI 재계획 요청`)·미리보기 카드·인박스 딥링크 일차에도 범위가 실린다.

## 6. 검증

- `apps/api` 45 suites / 455 tests 통과. 일자별 재계획 회귀 4건 추가 — 대상 일차만 교체·유지 일차 보존, AI 플래너 `dayCount=1` + 실제 일차 복원, 유지 일차 장소 후보 제외, 범위 밖 일차 → 전체 폴백. DTO 검증 2건(범위 수용·비정수 거부) 추가
- `apps/api`·`apps/web` `tsc --noEmit` 통과, eslint 0 error
- **실제 스택 엔드투엔드**(docker + api + web + Playwright 드라이버):
  - 3일 여행에서 모달로 2·3일차 선택 → 요청 본문 `targetDays:[2,3]`, 워커 jobId `…-manual-2.3-…` 확인
  - 3일차 단독 재계획 실행 → DB 상 1·2일차 12개 항목 그대로, 3일차만 새 5개. `scheduledAt` 도 3일차 날짜(7/29 KST 08:00 시작)로 정확
  - 실패 케이스(제약 위반으로 잡 실패) 에서 **유지 일차가 그대로 남는 것**도 함께 확인 — 삭제가 저장 직전에만 일어난다
  - 스크린샷: `.claude/skills/run-tripick/shots/replan-scope-*.png`
- 일차 간 이동 시간 검증이 빠지지 않는지 확인 — `ConstraintEngine` 은 원래 `current.day !== next.day` 쌍을 건너뛴다(일차 경계는 검증 대상이 아니었다). 부분 초안만 검증해도 전체 검증과 결과가 같다

## 7. 알려진 한계 / 후속 작업

- **일차 간 동선 연속성은 아무도 안 본다 — 의도한 동작이다.** 2일차만 다시 짜도 1일차 마지막 장소와 2일차 첫 장소의 거리는 고려되지 않는다(§6). 부분 재계획이 "나머지는 그대로" 라는 약속이라 눈에 띄기 쉬운 간극이지만, 재보니 **잴 대상 자체가 없다.** ① 일자별 지역([`per-day-region-v1.md`](../trips/per-day-region-v1.md))으로 1일차=부산·2일차=경주가 되면 경계 거리는 사용자가 고른 값이고, `perDayMode` 판정이 여행 전체 기준이라(§4.2) 다지역 여행에선 검사가 전부 오탐이 된다. ② 단일 지역이어도 그 선분은 아무도 걷지 않는다 — 사용자는 1일차 마지막 → **숙소** → 2일차 첫으로 가는데 숙소가 모델에 없다(`toItemType` 은 restaurant/cafe/attraction 만 만들고, KTO `contentTypeId=32` 는 적재 제외, 숙소 연동은 [v1 비목표](../overview/product-v1-scope.md)). 실재하지 않는 비용으로 후보를 떨어뜨리게 된다. ③ 앵커를 고르려 해도 기준점이 없다 — 숙소가 시내인데 전날 마지막이 외곽이면 전날 앵커는 2일차를 외곽으로 끌어당긴다. 숙소가 데이터에 들어오면 다시 볼 항목
- **범위가 여러 일차면 그 안에서만 최적화된다** — `[1,3]` 처럼 떨어진 일차를 고르면 AI 플래너에는 연속된 2일로 보인다(프롬프트의 `startDate`~`endDate` 도 1일차~3일차로 넓게 나간다). 날짜별 날씨·영업요일이 어긋날 수 있다
- **알림의 일차를 자동 확정하지 않는다** — 배너에서 열면 기본 선택까지만 하고, 사용자가 범위를 바꿔 제출할 수 있다. 의도한 동작이지만 "알림 그대로 실행" 원클릭은 없다
- **`targetDays` 상한 31 은 하드코딩** — DTO 단계에서 여행 일수를 모르기 때문이다. 31일 넘는 여행이 생기면 잘린다
- **로컬 LLM 이 없으면 결정적 폴백이 이동시간 제약에 자주 걸린다** — 부분 재계획과 무관한 기존 경로지만, 검증 중 실제로 재현됐다(서울 6항목/일 + transit). 실패 시 아무것도 저장되지 않는다
- ~~**`/alternative/request` 의 트리거 유실**~~ — 해소됨. 컨트롤러가 바디의 trigger 를 `manual` 로 덮어써 배너에서 연 재계획이 일반 재계획으로 처리되던 별도 버그로, `fix/replan-trigger-passthrough` 가 머지돼 범위와 트리거가 함께 살아난다

## 8. 변경 파일

```
packages/types/src/replanning.ts                      (ReplanRequestDto.targetDays)
apps/api/src/replanning/dto/replan-request.dto.ts     (targetDays 검증)
apps/api/src/replanning/replanning.service.ts         (jobId dedup 키에 범위)
apps/api/src/planner/planner.service.ts               (resolvePlanDays·remapPlanDays·excludeKeptPlaces,
                                                       planDays 기반 초안·배치, 부분 저장·응답 병합)
apps/api/src/itinerary/itinerary.service.ts           (replaceDayItems)
apps/api/src/schedule-change/schedule-change.service.ts  (제안 요약·딥링크 일차에 범위)
apps/web/src/features/request-replan/ui/replan-modal.tsx (재계획 범위 UI)
apps/web/src/views/planner/ui/planner-view.tsx        (days·defaultDay 전달, 범위 토스트)
apps/web/src/features/manage-schedule-changes/ui/schedule-change-preview-modal.tsx  (제안 미리보기)
apps/api/test/planner/planner.service.spec.ts         (회귀 4건)
apps/api/test/replanning/replan-request.dto.spec.ts   (검증 2건)
CLAUDE.md                                             (§3 재계획 플로우·§7 주의사항)
```

환경변수 추가 없음. 마이그레이션 없음(스키마 변경 없이 기존 `day` 컬럼만 활용).
