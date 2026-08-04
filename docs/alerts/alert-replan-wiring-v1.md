# 알림 → 재계획 배선 v1

문서 목적: 날씨·혼잡·미도착 알림을 눌렀을 때 planner 가 그 맥락을 프리필한 **재계획 제안 배너**를 띄우고, 사용자가 동의해야 재계획 잡이 돌도록 배선한 작업을 고정한다. 알림 자체는 여전히 "추천만" 하고 자동 재계획은 없다. `ReplanTrigger` 에 `crowd` 를 신설하고, 코드 리뷰에서 드러난 배선 부작용 5건을 함께 고쳤다(§6).

기준 브랜치: `feat/alert-replan-wiring` (base: `develop`)
작성일: 2026-07-26
선행 문서: [`docs/alerts/crowd-alert-scheduler-v1.md`](./crowd-alert-scheduler-v1.md) (§9 "수락 → 재계획 미배선" 후속), [`docs/alerts/weather-alert-scheduler-v1.md`](./weather-alert-scheduler-v1.md), [`docs/alerts/arrival-check-alert-v1.md`](./arrival-check-alert-v1.md) (세 알림의 발신 측), [`docs/notification/friend-request-push-and-deeplink-v1.md`](../notification/friend-request-push-and-deeplink-v1.md) (푸시 탭 딥링크 라우팅)
관련 컨텍스트: [`CLAUDE.md`](../../CLAUDE.md) §3 재계획 플로우, §7 "추천만, 재계획은 수동" 원칙

## 1. 범위

포함:

- 알림 카테고리 → 재계획 트리거 매핑, 인박스·푸시 양쪽 경로에서 공유
- planner 진입 시 비침습 재계획 배너(트리거별 문구), 배너 → 트리거 프리필 `ReplanModal`
- `ReplanTrigger` 에 `crowd` 신설 + DTO 검증·검색 키워드·memo 분기 반영
- 배선 부작용 수정 5건 (§6) — 완료 알림 루프, 장소명 오염, 푸시 경로 누락, 트리거 분기 누락, 배너 재등장

제외:

- **자동 재계획** — 의도적 제외. 배너를 닫으면 아무 잡도 돌지 않는다
- **집중률의 플래닝 점수 반영** — 의도적 제외([`crowd-alert-scheduler-v1.md`](./crowd-alert-scheduler-v1.md) §4 유지)
- 일차 단위 부분 재계획 — 현재 재계획은 여행 전체 재생성이다(§8 한계)
- 미도착 배너의 현재 위치 전달 — 미배선(§8 한계)

## 2. 배경 — 알림은 있는데 진입점이 없었다

날씨·혼잡·미도착 세 스캐너가 이미 "감지 → 인박스/FCM" 까지 완성돼 있었지만, 알림을 눌러도 planner 로 이동만 하고 거기서 재계획은 항상 `manual` 로 나갔다. `trigger:'weather'` 는 타입·프롬프트·검색 키워드까지 준비돼 있었는데 그 값을 실어 보낼 진입점이 없어 죽은 경로였다.

이번 작업은 그 마지막 한 칸 — **알림의 성격을 재계획 트리거로 실어 나르는 배선** — 을 채운다. 원칙은 그대로다: 알림은 권유만 하고, 잡은 사용자가 배너를 눌러야 돈다.

## 3. 데이터 흐름

```
[스캐너] weather_alert / crowd_alert / arrival_alert  (payload: tripId, day, …)
  → InboxService.create → 인박스 row + FCM 푸시
  → 사용자가 연다
      ├ 인박스 목록 → 액션 'open-trip'(label '일정 변경', replan 필드)
      └ 푸시 탭      → routeForNotification (SW·RN 브리지 공통)
      → /planner?tripId=…&day=…&replan=<trigger>
  → PlannerView: 비침습 배너 (트리거별 문구)
      ├ 닫기       → 배너 해제 + URL 의 replan 제거, 잡 미실행
      └ AI 재계획  → 트리거 프리필 ReplanModal → POST /replanning (trigger)
          → BullMQ replan job → PlannerService.replan
          → AlternativeProcessor: WS push + replan_ready 결과 알림
```

## 4. 카테고리 → 트리거 매핑은 공유 상수 하나

매핑 정본은 [`packages/types/src/inbox.ts`](../../packages/types/src/inbox.ts) 의 `REPLAN_TRIGGER_BY_CATEGORY` 다.

| 알림 카테고리 | 재계획 트리거 | 배너 문구 |
| ------------- | ------------- | --------- |
| `weather_alert` | `weather` | ⛅ 이 날 날씨 변화가 예상돼요 / 실내·대체 장소 위주로 다시 짜볼까요? |
| `crowd_alert` | `crowd` | 🚶 이 날 혼잡이 예상돼요 / 덜 붐비는 장소로 다시 짜볼까요? |
| `arrival_alert` | `deviation` | 📍 일정 장소에 도착하지 못한 것 같아요 / 지금 위치에 맞춰 다시 짜볼까요? |
| 그 외(`replan_ready`·`trip_reminder`·`general` …) | 없음 | 단순 일정 보기 |

**결정: 표를 서버 액션 빌더가 아니라 공유 타입 패키지에 둔다.** 소비처가 둘(인박스 액션 빌더, 푸시 탭 라우팅)이고, 한쪽만 알면 그 경로에서 기능이 통째로 죽는다(§6.3). 서비스 워커([`apps/web/public/firebase-messaging-sw.js`](../../apps/web/public/firebase-messaging-sw.js))는 앱 코드를 import 할 수 없어 같은 표가 복제돼 있고, 양쪽 주석에 동기화 의무를 남겼다.

`replan_ready` 를 표에서 뺀 것이 중요하다 — 이건 재계획 **결과** 알림이라 여기에 재계획 액션이 붙으면 루프가 된다(§6.1).

## 5. planner 배너 — 권유만 하는 UI

- 배너는 `?replan=` 쿼리가 있을 때만 뜬다. 쿼리 파싱은 [`apps/web/src/app/planner/page.tsx`](../../apps/web/src/app/planner/page.tsx) 의 화이트리스트 검증을 거쳐 `initialReplanTrigger` 로 내려간다(임의 문자열 차단)
- 두 반응형 레이아웃 공통으로 상단 중앙 고정. 버튼은 `AI 재계획` / `닫기` 두 개 + 우상단 X
- **닫으면 URL 의 `replan` 도 같이 지운다.** 남겨두면 뒤로가기·새로고침 재진입마다 이미 처리한 제안이 다시 뜬다(§6.5)
- `AI 재계획` 은 잡을 바로 걸지 않고 트리거가 프리필된 `ReplanModal` 을 연다 — 사용자가 노트·필수 장소·강도를 마저 채운 뒤 제출한다
- `manual` 은 배너 문구 맵에서 제외했다. 사용자가 직접 버튼을 누른 경우라 권유할 대상이 아니다

## 6. 설계 판단 (코드 리뷰에서 교정된 것)

배선 자체보다, "트리거가 이제 `manual` 이 아닐 수 있다" 는 전제 변화가 서버 곳곳에서 부작용을 냈다. 리뷰에서 잡힌 순서대로 고쳤다.

### 6.1 재계획 결과 알림은 항상 `replan_ready`

`AlternativeProcessor` 는 완료·실패 알림을 `trigger === 'weather' ? 'weather_alert' : 'replan_ready'` 로 보내고 있었다. 배선 전에는 owner 재계획이 항상 `manual` 이라 이 분기가 안 탔지만, 배너 경로가 `weather` 를 보내기 시작하면서 두 가지가 동시에 터졌다.

1. **무한 권유 루프** — `재계획 완료` 카드가 `weather_alert` 로 저장되니 §4 매핑이 여기에도 "일정 변경" 재계획 액션을 붙인다. 누르면 또 weather 잡 → 또 완료 알림 → 또 배너
2. **결과 알림 소실** — 날씨 알림 수신을 끈 사용자는 `prefersCategory` 게이트에 막혀, 본인이 요청한 재계획의 완료·실패조차 인박스에도 푸시에도 받지 못한다

**결정: 결과 알림은 트리거와 무관하게 `replan_ready`.** 이건 제안이 아니라 결과라, 발신 카테고리가 트리거를 따라다닐 이유가 없다. 트리거는 payload 에 그대로 남는다.

### 6.2 장소명에 트리거 토큰을 붙이지 않는다

`buildPlaceName` 이 1일차 항목(첫 항목 제외) 이름 뒤에 `(crowd 대응)` 같은 꼬리표를 붙여 저장하고 있었다. 배선 전에는 트리거가 대부분 `manual` 이라 눈에 덜 띄었다.

- 사용자에게 영문 enum 이 그대로 노출된다 — 일정 화면·공유 이미지·알림 본문
- 이름이 바뀌므로 다음 재계획 때 memo 보존용 장소 키 매칭이 어긋나 사용자 메모가 사라진다

**결정: 함수째 제거.** 트리거 맥락은 `buildMemo` 가 한국어 설명으로 이미 남기므로 정보 손실이 없다.

### 6.3 매핑을 공유 상수로 — 푸시 탭 경로가 비어 있었다

매핑이 인박스 액션 빌더 안에만 있어서, **푸시를 직접 탭한 사용자에겐 배너가 아예 안 떴다**. `routeForNotification` 이 `/planner?tripId=` 만 만들었기 때문이다. 배너를 보려면 푸시를 무시하고 인박스에서 같은 알림을 다시 눌러야 했다 — 알림 소비의 주 경로에서 기능이 죽는 셈이다.

**결정: 표를 `packages/types` 로 올리고 양쪽이 참조.** 푸시 경로도 `day`·`replan` 쿼리를 실어 인박스 경유와 같은 화면에 도착한다.

### 6.4 트리거 분기는 `Record<ReplanTrigger, …>` 전수 테이블

`crowd` 를 유니온에 추가했는데 `if`/삼항 체인으로 분기하던 서버 코드는 컴파일 에러 없이 조용히 기본값으로 떨어졌다(`crag-evaluator` 의 `triggerScore` 가 실제로 그랬다). 세 곳을 전수 테이블로 교체했다.

| 위치 | 테이블 | 비고 |
| ---- | ------ | ---- |
| `crag-evaluator.service.ts` | `TRIGGER_SCORE` | crowd 는 후보 단위 "붐빔" 신호가 없어 중립값(0.64)을 명시. 조향은 검색 키워드가 담당 |
| `kakao-local.service.ts` | `TRIGGER_KEYWORDS` | 키워드 값 자체는 변경 없음 |
| `planner.service.ts` | `TRIGGER_MEMO_NOTE` | buildMemo 꼬리말 |

검증으로 `ReplanTrigger` 에 임시 값을 하나 넣고 빌드해, 컴파일 에러가 정확히 이 세 테이블에서만 나는 것을 확인한 뒤 되돌렸다.

### 6.5 배너를 닫으면 `?replan=` 도 지운다

쿼리가 남아 있으면 재진입·새로고침마다 배너가 부활해, 이미 처리한 제안을 반복해서 권유받는다. `dismissAlertBanner` 가 배너 state 해제와 함께 `history.replaceState` 로 `replan` 파라미터만 제거한다.

**결정: `router.replace` 가 아니라 `history.replaceState`.** 라우터 교체는 리렌더·쿼리 재요청을 부르는데, 여기서 필요한 건 주소창 정리뿐이다. 닫기 버튼 2개와 `AI 재계획` 진입 경로 모두 이 핸들러를 지난다.

## 7. 검증

- `apps/api` 테스트 44 suites / 449 tests 통과. 회귀 테스트 2건 추가 — weather 트리거 잡의 결과 알림이 `replan_ready` 로 나가는지(§6.1), crowd 재계획에서 1일차 항목 이름에 트리거 토큰이 없는지(§6.2)
- `apps/api`·`apps/web` `tsc --noEmit` 통과
- `apps/web` eslint 통과 (기존 경고 3건은 이번 변경과 무관한 파일)
- 트리거 유니온 전수성: 임시 트리거 추가 시 §6.4 세 테이블에서 컴파일 에러 3건 발생 확인
- 브라우저 실행 확인은 하지 않았다 — 배너·쿼리 정리는 정적 검사까지만 검증한 상태

## 8. 알려진 한계 / 후속 작업

- ~~**배너는 "이 날" 을 말하지만 재계획은 여행 전체**~~ — 해소: [`docs/planner/day-scoped-replan-v1.md`](../planner/day-scoped-replan-v1.md). `targetDays` 로 대상 일차만 재생성하고, 알림 딥링크의 일차가 재계획 모달의 기본 범위가 된다
- ~~**미도착 배너가 현재 위치를 안 보낸다**~~ — 해소: [`ReplanningService.enqueue`](../../apps/api/src/replanning/replanning.service.ts) 가 `deviation` 재계획에 미도착 판정용 위치 캐시(`LiveLocationService`)를 실어 준다. 배너까지 스레딩하지 않은 이유는 RN 에선 네이티브가 위치를 보고해 웹뷰 JS 에 좌표가 없기 때문이고, 신선도(10분)·대상 일차 장소로부터 30km 가드로 여행지 밖 요청엔 앵커를 걸지 않는다. `deviatedItemId` 는 읽는 코드도 보내는 코드도 없는 죽은 필드였어 함께 제거했다 — 미도착 맥락이 실제로 필요한 자리는 "지금 이후만 재계획"(하루가 여전히 `wakeTime` 부터 다시 짜인다)이고 그건 항목 ID 가 아니라 시작 시각 앵커를 요구한다([backlog](../plans/2026-07-21-open-backlog.md))
- ~~**jobId 중복 제거가 트리거별로 갈린다**~~ — 해소: dedup 을 시간 창 키가 아니라 **진행 중인 잡 조회**로 바꿨다([`ReplanningService.findInFlight`](../../apps/api/src/replanning/replanning.service.ts)). 같은 여행에서 대상 일차가 겹치는 잡이 이미 큐(waiting·active·delayed)에 있으면 새로 등록하지 않고 그 잡을 `deduped: true` 로 돌려준다. 트리거는 보지 않는다 — 무엇 때문에 눌렀든 같은 일차를 다시 짜는 작업이면 중복이다
- **재계획 트리거 키워드에 `맛집` 계열이 없다** — weather·deviation·crowd 셋 다. 후보 풀에 restaurant 가 얇아 식사 슬롯이 빌 수 있다. 값 변경은 후보 풀이 실제로 바뀌는 동작 변경이라 이번 범위에서 빼고 `TRIGGER_KEYWORDS` 에 NOTE 로만 남겼다

## 9. 변경 파일

```
packages/types/src/replanning.ts                       (ReplanTrigger 에 crowd)
packages/types/src/inbox.ts                            (REPLAN_TRIGGER_BY_CATEGORY, 액션 replan 필드)
apps/api/src/inbox/inbox.service.ts                    (액션 빌더가 공유 표 참조)
apps/api/src/alternative/alternative.processor.ts      (결과 알림 replan_ready 고정)
apps/api/src/planner/planner.service.ts                (buildPlaceName 제거, TRIGGER_MEMO_NOTE)
apps/api/src/planner/retrieval/crag-evaluator.service.ts  (TRIGGER_SCORE)
apps/api/src/planner/retrieval/kakao-local.service.ts     (TRIGGER_KEYWORDS)
apps/api/src/replanning/dto/replan-request.dto.ts      (crowd 검증)
apps/api/src/schedule-change/dto/schedule-change.dto.ts   (crowd 검증)
apps/web/src/app/planner/page.tsx                      (replan 쿼리 파싱·화이트리스트)
apps/web/src/views/planner/ui/planner-view.tsx         (배너·문구·dismissAlertBanner)
apps/web/src/views/inbox/ui/inbox-view.tsx             (액션 → replan 쿼리)
apps/web/src/features/request-replan/…                 (모달·훅 trigger 스레딩)
apps/web/src/shared/web-push/route.ts                  (푸시 탭 → day·replan 쿼리)
apps/web/public/firebase-messaging-sw.js               (SW 복제 규칙 동기화)
apps/api/test/alternative/…, apps/api/test/planner/…   (회귀 테스트 2건)
```

환경변수 추가 없음.
