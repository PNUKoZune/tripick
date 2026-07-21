# 취침 시간 · DTO 검증 수정 v1

문서 목적: 프로젝트 전반 검토에서 나온 버그 2건과 낡은 e2e 1건을 고친 작업을 고정한다. 두 버그는 **야행성 사용자가 여행을 아예 만들 수 없는** 하나의 증상으로 이어져 있었고, 그 뿌리는 "취침은 기상보다 늦다"는 가정과 **검증이 켜져 있다는 착각**이었다.

기준 브랜치: `fix/sleep-time-and-dto-validation`
관련 문서: [`docs/planner/main-planner-v1.md`](../planner/main-planner-v1.md), [`docs/planner/routing-external-api-v1.md`](../planner/routing-external-api-v1.md)

커밋: `267407b`(자정 넘는 취침) → `4dc3893`(ValidationPipe 복구) → `3df3f06`(낡은 e2e)

## 1. 범위

포함:

- 자정을 넘는 취침 시간(예: 기상 08:00 / 취침 01:00) 정식 지원
- 인터페이스 DTO 로 무력화돼 있던 `ValidationPipe` 복구 (4개 모듈)
- `travel-ai-planner` e2e 의 낡은 단언 3건 수정

제외:

- **영업시간 데이터 소스** — `openingHours` 는 하드코딩 시드에만 있어 실데이터에선 검증이 무동작 (6절)
- **연관 관광지 · 방문자 추이 예측 API** — CLAUDE.md 6절에 있으나 미구현
- **날씨 트리거 재계획 스케줄러** — `alternative.processor.ts` 에 backlog 주석으로 명시된 진입점 부재
- `main-planner` DTO 의 느슨한 `\d{2}:\d{2}` — 이번 범위 밖 (4절)

## 2. 야행성 사용자는 여행을 만들 수 없었다

취향 설정에 **취침 01:00 / 기상 08:00** 을 저장하면 저장은 성공하는데, 그 뒤로 여행 생성이 400 으로 막혔다.

```
취향 설정 저장 (취침 01:00)         → 200 OK
  ↓ main-planner.createTrip 이 취향값을 여행 생성에 주입
trips.service.assertTrip            → 400 "wakeTime must be earlier than sleepTime"
```

사용자는 **여행 만들기 화면에서 시간을 입력한 적이 없다.** 값은 취향 설정에서 조용히 딸려 왔고, 에러는 그 화면에서 고칠 수도 없다. 원인 화면과 증상 화면이 다르다는 게 이 버그의 악질적인 부분이다.

가드를 통과하더라도 Constraint Engine 이 무너진다. 런타임으로 재현한 결과:

```
오전 10시 일정 / 60분
  취침 23:00 → issues: []
  취침 01:00 → issues: ["\"경복궁\" 기상/취침 시간 범위 밖 일정"]
```

`visitStart >= wake && visitEnd <= sleep` 은 취침(60분)이 기상(480분)보다 작으면 **어떤 일정에도 참이 될 수 없다.** 정상적인 낮 일정까지 전부 위반으로 보고됐다.

세 곳(취향 폼 · trips 가드 · 제약 엔진)이 모두 "취침은 기상보다 늦은 같은 날"이라고 가정하는데, 정작 그걸 강제하는 곳은 trips 하나뿐이었다.

## 3. 벽시계 비교를 버리고 "기상 이후 경과 분"으로

취침·기상을 벽시계 분으로 비교하면 자정을 넘는 구간에서 반드시 뒤집힌다. 기상을 원점으로 하는 **선형 축**으로 옮기면 두 경우가 같은 식이 된다.

```
elapsed    = (일정 시각 - 기상 + 1440) % 1440
windowLen  = (취침 - 기상 + 1440) % 1440
창 안에 들어가는가 = elapsed + durationMin <= windowLen
```

| 기상 | 취침 | windowLen | 10:00 일정 | 02:00 일정 |
| --- | --- | --- | --- | --- |
| 07:00 | 23:00 | 960분 | elapsed 180 → 통과 | elapsed 1140 → 위반 |
| 08:00 | 01:00 | **1020분** | elapsed 120 → 통과 | elapsed 1080 → 위반 |

같은 계산을 `ConstraintEngine` 과 `ScheduleConstraint` 가 각자 들고 있으면 어긋난다 — 애초에 이 버그가 두 곳이 시간 의미를 달리 봐서 생겼다. 정본을 `packages/utils/src/awake-window.ts` 로 뺐고, 양쪽이 중복으로 갖고 있던 `timeToMinutes`·`getKstMinutes` 도 함께 정리됐다.

**기상 == 취침은 활동 구간을 하루로 본다.** 0분으로 두면 모든 일정이 범위 밖이 되어 검증이 사용자를 막는 방향으로 실패한다. 이 값 자체는 입력 단계에서 거부하는 게 정상이라(4절) 방어적 기본값이다.

### 3-1. 보정 방향은 "가까운 쪽"

`ScheduleConstraint` 는 수면 구간에 놓인 일정을 기상 쪽으로 **밀지**, 취침 전으로 **당길지** 골라야 한다. 최단 이동 규칙을 쓴다 — 멀리 옮길수록 원래 의도한 시간대에서 벗어나고, 하루를 건너뛰면 다음 날 일정과 겹친다.

| 일정 | 기상/취침 | 밀기 | 당기기 | 선택 |
| --- | --- | --- | --- | --- |
| 05:30 | 07:00 / 23:00 | +90분 → 07:00 | -450분 → 22:00 | **밀기** |
| 23:30 | 07:00 / 23:00 | +450분 → 다음날 07:00 | -90분 → 22:00 | **당기기** |
| 05:00 | 08:00 / 01:00 | +180분 → 08:00 | -300분 → 00:00 | **밀기** |

이 규칙이 **기존 보정 동작을 그대로 재현**한다는 게 핵심이다. 기존 테스트 4개를 한 줄도 고치지 않고 자정 넘는 구간만 얹었다.

### 3-2. 덤으로 닫힌 날짜 밀림

기존 보정은 `setUTCHours` 로 벽시계 필드를 덮어썼다. KST 00:00~08:59 는 UTC 날짜가 전날이라, 자정을 넘는 시각을 다룰 때 **날짜가 하루 밀릴 수 있는** 경로가 있었다. 보정을 인스턴트 가감(`+delta * 60000`)으로 바꾸면서 사라졌다 — KST 는 DST 가 없어 안전하다.

trips 가드는 이제 **기상·취침이 같은 경우만** 거부한다. 활동 0분과 24시간 중 무엇을 뜻하는지 정할 수 없기 때문이다.

## 4. ValidationPipe 는 켜져 있지만 꺼져 있었다

`main.ts` 에 `whitelist` · `forbidNonWhitelisted` · `transform` 이 모두 켜져 있다. 그런데 `trips` · `preferences` · `trip-members` · `friends` 컨트롤러는 `@Body()` 를 **인터페이스 타입**으로 받았다.

```ts
@Body() dto: CreateTripDto   // 인터페이스 → 런타임에 소멸 → metatype 이 Object
```

NestJS `ValidationPipe` 는 metatype 이 `Object` 면 검증 대상이 아니라고 보고 **통째로 건너뛴다.** 검증만 빠지는 게 아니라 whitelist 필드 제거도 같이 빠진다. 설정은 멀쩡한데 효과가 0이라 눈에 띄지 않는다.

`POST /trips` 로 실증한 결과(수정 전):

| 보낸 값 | 결과 |
| --- | --- |
| `wakeTime: "banana"` | **201**, 그대로 저장 |
| `sleepTime: {$ne: null}` | **201**, `"{\"$ne\":null}"` 로 강제 변환돼 저장 |
| `transportMode: "teleport"` | **201**, 그대로 저장 |
| `injectedField: "..."` (미정의) | **201**, 통과 |

수정 후 같은 페이로드가 **400** 과 함께 위반 5건을 돌려준다.

`transportMode: "teleport"` 는 단순한 쓰레기 값이 아니라 **크래시 경로**였다. 저장은 되고, 나중에 `RouteHelper.getEta` 의 exhaustive `switch` 가 이 값을 만나 던진다 — 즉 일정 생성 시점에 터진다.

2절 버그도 여기서 자란다. 취향 설정에는 시간 형식 검증이 아예 없어 `"banana"` 도 저장됐다.

### 4-1. 붙인 방식

`main-planner` · `replanning` 의 기존 관례(`XxxBodyDto implements XxxDto`, `as const satisfies readonly T[]`)를 따랐다.

| 모듈 | DTO |
| --- | --- |
| `trips` | `CreateTripBodyDto`, `UpdateTripBodyDto` |
| `preferences` | `UpdatePreferenceBodyDto`(+ `TasteTagBodyDto`, `PreferenceProfileBodyDto`) |
| `trip-members` | `CreateTripMemberBodyDto`, `UpdateTripMemberBodyDto` |
| `friends` | `AddFriendRequestBodyDto` |

- **시간 패턴은 공유 상수**(`common/validation/patterns.ts`)로 뺐다. 기존 관례인 `\d{2}:\d{2}` 는 `"99:99"` 를 통과시킨다. 자릿수만 세지 말고 실재하는 시각인지 본다.
- **`transportMode` 는 정본 `RouteMode` 로 제한**한다.
- **nullable 필드**(`notes`, `contact`, `kakaoId`, `relation`)는 `null`(삭제 의도)을 통과시키고 문자열일 때만 형식을 본다.
- **`preferences` 는 병합 결과로 교차 검증**한다. dto 가 `sleepTime` 만 보내도 `wakeTime` 은 저장값·기본값에서 오므로, 들어온 필드만 검사하면 같은 시각이 저장된다.

`main-planner` 의 느슨한 `\d{2}:\d{2}` 는 이번 범위 밖으로 남겼다. 같은 상수로 통일하면 정리된다.

## 5. e2e 는 일주일째 red 였다

`travel-ai-planner` e2e 가 실패하고 있었다. **프로덕션이 아니라 테스트가 낡았고, 원인이 두 개 겹쳐 하나에 가려져 있었다.**

**5-1. 날짜 시한폭탄.** 여행 날짜가 `2026-07-10` 으로 하드코딩돼 있는데 `summaryStatus` 는 오늘 날짜와 비교한다. 그 날이 지나며 `upcoming` → `done` 이 됐다. 오늘+2일 상대 날짜로 교체했다(타임존 경계 여유).

**5-2. memo 단언.** 날짜를 고치자 그 뒤 단언에서 다시 터졌다. 실제 memo 를 찍어보니 전부 `null` 이었다. 커밋 `186e5df`(2026-07-10)가 **memo 를 사용자 메모 공간으로 전용화**하며 생성·재계획 양쪽에서 저장하지 않게 바꿨는데 이 테스트를 같이 고치지 않았다. 두 원인이 같은 날 겹친 셈이다.

여기서 판단이 갈린다 — 테스트가 맞고 코드가 버그인가? **아니다.** 웹 UI 에서 memo 는 사용자가 직접 편집하는 필드다("예약 시간, 준비물 등 나만의 메모"). 재계획이 거기에 "웨이팅 35분 반영"을 써넣으면 **사용자 메모를 덮어쓴다** — `186e5df` 가 막으려던 동작 그 자체다. 코드가 맞고 테스트가 낡았다.

그래서 단언을 현재 동작(생성·재계획이 memo 를 비워 둠)으로 **뒤집었다.** 이제 이건 "생성이 사용자 메모를 덮어쓰기 시작하면 잡아내는" 회귀 테스트다. 재계획 반영 여부는 기존의 항목 이름(`waiting 대응`) 단언이 그대로 커버한다.

테스트 안에 있던 자체 시각 계산(`isWithinKstBounds`)도 정본 유틸로 교체했다. 테스트가 따로 계산하면 자정을 넘는 구간에서 프로덕션과 어긋난다 — 2절과 같은 실수다.

## 6. 붙인 지점

```
packages/utils/awake-window        # 활동 구간 정본
 ├ ConstraintEngine.checkScheduleBounds   # 위반 판정
 └ ScheduleConstraint.apply               # 보정 (최단 이동)

main.ts ValidationPipe             # 설정은 그대로, DTO 가 class 여야 동작
 ├ trips / preferences / trip-members / friends 컨트롤러
 └ preferences.service.upsert             # 병합 결과 교차 검증
```

| 파일 | 역할 |
| --- | --- |
| `packages/utils/src/awake-window.ts` | 활동 구간 계산 정본 (신설) |
| `apps/api/src/planner/constraint/constraint.engine.ts` | 기상·취침 위반 판정 |
| `apps/api/src/planner/helpers/schedule.constraint.ts` | 일정 보정 |
| `apps/api/src/trips/trips.service.ts` | 여행 생성 가드 |
| `apps/api/src/common/validation/patterns.ts` | 시간·날짜 패턴 공유 (신설) |
| `apps/api/src/{trips,preferences,trip-members,friends}/dto/` | class DTO (신설) |
| `apps/api/src/preferences/preferences.service.ts` | 기상·취침 교차 검증 |

## 7. 검증

```
유닛   api    149 → 183   (+34)
       utils   54 →  65   (+11)
e2e             55 →  56   전체 통과 (기존 1건 red → 0)
```

- **자정 넘는 취침**: 런타임으로 실패를 먼저 재현하고(오전 10시 일정이 위반으로 보고됨) 고친 뒤 `issues: []` 확인. 여행 생성이 400 → **201**.
- **ValidationPipe**: e2e 하네스(`main.ts` 설정 재현)로 쓰레기 페이로드가 **201 로 저장되는 것**을 먼저 실증한 뒤, 수정 후 **400** 확인. 단위 테스트만으론 DTO 를 컨트롤러에 배선하지 않아도 통과하므로 e2e 로 배선까지 고정했다.
- 기존 테스트는 한 건도 수정하지 않았다(5절의 낡은 e2e 제외). 최단 이동 규칙을 고른 이유가 이것이다.

## 8. 알려진 제한 / 후속

- **영업시간 검증이 실데이터에선 무동작** — `openingHours` 는 `place-seeds.ts` 하드코딩 시드에만 있고 카카오 로컬·관광공사 수집 경로 어디서도 채우지 않는다. `checkOpeningHours` 는 값이 없으면 무조건 통과시키므로 사실상 죽어 있다. CRAG 평가기도 0.58 기본값으로 떨어진다. CLAUDE.md 6절은 `detailCommon` 으로 영업시간을 받는다고 적어뒀으나 구현된 건 `areaBasedList2` 뿐이다.
- **영업시간이 자정을 넘는 경우**(예: 22:00-02:00 바)는 여전히 벽시계 비교다. 3절의 활동 구간 계산을 그대로 쓸 수 있으나 데이터 소스가 없어 미룬다.
- **CRAG · AI 파이프라인의 API 관측 지점이 없다** — 근거가 memo 에서 빠지면서 로그에만 남는다. e2e 가 "AI 가 실제로 돌았는지"를 확인할 방법이 없어 항목 생성 여부로 간접 확인한다. `PlannerTripMetaDto` 에 CRAG source·confidence 를 노출하는 게 자연스럽다.
- **재계획이 사용자 메모를 날린다** — `replaceTripItems` 로 항목을 통째로 교체하므로 사용자가 남긴 memo 도 함께 사라진다. memo 전용화 취지와 어긋나 보이나 이번 범위 밖.
- **`main-planner` DTO 의 `\d{2}:\d{2}`** 는 `"99:99"` 를 통과시킨다. `common/validation/patterns` 로 통일 필요.
- **`isoDate` 가 서버 로컬 타임존 기준**이다. `summaryStatus` 가 이 값으로 여행 상태를 정하므로, 서버가 UTC 면 KST 00:00~08:59 구간에서 하루 전 날짜로 판단한다. e2e 는 +2일 여유로 피해 갔을 뿐 근본 문제는 남아 있다.
