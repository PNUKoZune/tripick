# 일정 최적화 도구 구현 및 검증

작성일: 2026-10-18. 새 API와 탐색은 기본 비활성이다. 운영 채택 여부는 아직 결정하지 않았다.

## 구현 범위와 기준

최초 작업·합성 fixture 기준은 `7b50fbea052c1539efb82933c79e3c06a420af95`다. 게시 준비 중 원격을 fetch하여 문서의 기준 커밋 `01c71fd3bb77ecb01ae612771d626a2dd2e0b405`를 확보했고, 게시 브랜치는 이 최신 `origin/main` 위에서 통합했다. 다른 작업의 생성 원장·추론 자원 변경은 포함하지 않았다.

최초 로컬 checkout에는 시각 고정의 `pinMisses`가 없었지만 최신 main에는 구현되어 있다. 게시한 `algorithm/baseline.ts`는 최신 main의 **하드 제약 통과 → 시각 고정 누락 최소 → shortfall 최소 → 동점이면 기존 안 보존** 정책을 그대로 유지한다. 기존 PlannerService의 시각 고정·재배치·누락 계수는 보존하고, 근접 정렬·항목 수·수용·폴백 비교만 순수 함수로 추출했다. 새 도구의 `pinMisses`는 snapshot의 필수 ID 누락 수이며, 기존 생성기의 시각 고정 누락 수와 자동으로 같은 지표라고 가정하지 않는다. 시각을 고정할 항목은 context의 잠금으로 지정하면 전체 값이 보존된다. 전체 초안 생성기와 저장 orchestration은 기존 PlannerService에 남아 있다.

새 계산 경로는 `planner/tools/`에 있다. 여행 소유권·후보·검증·계산은 Nest가 담당하고 Python은 MCP 연결과 모델의 도구 선택을 실행한다. Python에 여행 최적화 알고리즘을 다시 구현하지 않았다.

## API

모든 경로는 `/api/v1/trips/:tripId/planning` 아래이며 JWT와 여행 소유권을 검사한다. 성공 시 HTTP 200이다. 도구는 저장된 일정을 변경하지 않는다.

| POST 경로 | 입력 | 결과 |
| --- | --- | --- |
| `/context` | 선택: `lockedItemIds`, `requiredItemIds`, `refreshCandidates`, `origin` | snapshot·여행 조건·기존 일정·후보·잠금·목표 |
| `/validate` | `snapshotId`, `snapshotVersion`, 선택: `items` 또는 `candidateId` | 복제·정규화 결과, 변경 이력, 위반·미확인 조건, 지표 |
| `/evaluate` | validate와 동일 | 동일 계산 기준의 평가 |
| `/optimize` | 동일 + 선택: `maxEvaluations`, `timeBudgetMs` | 변경안·전후 평가·평가 횟수·조회 수·종료 이유 |

`items`와 `candidateId`는 함께 보낼 수 없다. 둘 다 생략하면 snapshot의 기존 일정을 사용한다. 항목의 최소 입력은 `{id, day, order, scheduledAt, durationMin}`이며 장소 정보는 서버 snapshot에서 가져온다. 전체 항목을 보내면 명칭·좌표·영업시간·메모 등은 서버 원본과 일치해야 한다. 임의 장소 ID, 여행·지역별 허용 일차를 벗어나는 배치, 중복 ID/순서는 거부한다. 기존 일정의 장소는 기존 일차에 고정된다.

공통 응답에는 `schemaVersion`, `algorithmVersion`, `constraintVersion`, `snapshotId`, `snapshotVersion`, `candidateId`, `metrics`, `violations`, `unknownConstraints`, `terminationReason`이 포함된다. context에는 candidate 평가가 없으므로 `candidateId`·평가 지표는 없다.

snapshot과 candidate는 Redis에 저장한다. snapshot TTL은 15분이며 candidate TTL은 snapshot 잔여 시간 이내다. snapshot당 저장 후보는 최대 100개이고 증가·만료·저장은 Lua로 원자적으로 처리한다. 저장소 장애 시 프로세스 메모리로 우회하지 않고 503을 반환한다. 같은 snapshot의 동시 최적화는 Redis lease로 차단한다. 종료 시 소유 토큰을 확인해 lease를 해제한다.

snapshot version은 여행 행·일차별 지역 행·전체 일정 행의 SHA-256이다. 생성 중/계산 전후에 현재 version을 다시 조회하며 편집이 있으면 409로 재계산을 요구한다. snapshot·candidate 조회에도 소유권과 만료를 검사하고 schema·algorithm·constraint version이 다른 snapshot은 거부한다.

이미 시작했거나 지난 항목과 사용자가 잠근 항목은 값 전체를 보존한다. snapshot 생성 후 시간이 지나 시작한 항목도 동적으로 보호한다. 정규화가 잠긴 항목을 옮기려고 하면 위반을 반환하고 응답 항목에는 보호된 원본을 남긴다. 필수 항목 누락은 `pinMisses`와 위반으로 보고하고 유효 결과로 인정하지 않는다.

이 API에는 저장·확정·apply 기능이 없다. 기존 저장 경로에 snapshot version 검사가 이미 있다고 가정하지 않는다. 향후 사용자 동선에 변경안 적용을 추가하려면 기존 작성자 모두와 같은 트랜잭션/버전 계약을 연결해야 한다. 현재의 마지막 version 검사는 변경안 조회 시점의 최신성 검사이며, 나중의 저장을 보장하는 잠금이 아니다.

## 계산과 제한

검증은 `ScheduleConstraint.apply`를 복제 입력에 적용한다. `normalizedItems`, `normalizationChanges`에 실제 조정 내용을 남긴다. `items`는 기존 소비자용 별칭이다. 잘못된 날짜·좌표·일차·기간은 외부 경로 조회 전에 거부한다. 영업시간 누락/해석 불가는 미확인 조건이고, 경로 실패·타임아웃은 검증 불가 위반과 미확인 조건을 함께 남긴다. 야간 활동 구간, 자정 이후 영업, `24:00`을 처리한다.

탐색은 같은 일차 안의 swap/insertion이며 잠금 항목을 경계로 구간을 나눈다. 방문 ID·장소 정보·체류 시간은 그대로 두고 순서와 방문 시각을 다시 계산한다. 후보마다 ETA·시간창을 재검증한다. 비교 순서는 유효성 → `pinMisses` → `shortfall` → ETA다. 목표 부족과 취향 점수는 보고용이며 숨은 동점 기준으로 쓰지 않는다. 최적해를 보장하지 않는다.

- 후보 평가는 baseline 포함 최대 50회, 탐색 시간은 최대 2초다. 작은 요청값을 허용하고 내부 호출도 상한으로 제한한다.
- 최적화 1회당 RouteHelper 조회는 서로 다른 좌표·이동수단 조합 최대 128개다. 재배치/검증/출발지 계산은 같은 요청 내 ETA를 공유한다. 초과 시 지금까지의 최선 평가와 `ROUTE_LOOKUP_LIMIT`을 반환한다.
- 개별 경로 대기는 최대 1.5초다. 탐색 deadline과 취소는 별도로 강제한다. 이미 시작한 RouteHelper 공유 HTTP 요청 자체는 완료될 수 있지만 취소 후 새 조회를 시작하지 않는다.
- 유효 후보가 있으면 시간·평가·조회 예산 도달 시 그 후보를 반환한다. baseline도 평가하지 못하면 408이다. 유효 안을 찾지 못하면 `valid=false`와 명시적 종료 이유를 반환한다.
- 일정 입력 최대 100개, 후보 context 최대 200개다. 후보 검색은 전체 15초 안에서 일차별 지역 최대 20개를 조회한다.
- RouteHelper의 ETA에는 기존 거리 추정 폴백이 포함된다. `routeEvidence: route-helper`는 실제 외부 경로 API 응답을 증명하지 않는다.

출발 좌표 `origin`은 가장 이른 대상 일차의 첫 항목이 잠기지 않았을 때 그 첫 방문까지의 ETA·출발 가능 시각에 반영된다. 기존 방문 뒤의 현재 위치에서 재출발하는 기능과는 별도 계약이다. 잠긴 첫 방문 이후 현재 위치 재계획은 기존 PlannerService 경로를 사용한다.

`shortfall`은 제출된 배치안 대비 정규화 후 줄어든 개수다. 새 도구는 항목을 조용히 잘라내지 않으므로 보통 0이며, 목표 대비 부족은 `targetShortfall`로 따로 보고한다. 후보 부족은 `CANDIDATE_SHORTAGE`, 후보가 있는데 빈 배치이면 `PLACEMENT_FAILED`다.

## MCP와 Agent

[Python 실행 문서](../../tools/planning-agent/README.md)에 서버·CLI·인증·모델 설정을 정리했다. 공개 도구는 `get_planning_context`, `validate_itinerary`, `evaluate_itinerary`, `optimize_itinerary` 네 개다. 동기 제한 탐색만 제공하므로 존재하지 않는 job/status 도구를 광고하지 않는다. 장기 작업의 202/job 계약과 worker 복구는 이번 경로에 구현하지 않았다.

모델 응답의 실제 `tool_calls`를 검증한 뒤 stdio MCP client가 실행하고 결과를 다음 모델 메시지로 돌려준다. 도구 순서를 고정한 실행 로그를 모델 선택의 증거로 사용하지 않는다. trip/snapshot과 CLI의 잠금·필수 조건을 세션에서 고정한다. 도구 시도 최대 10회, 모델 재시도 최대 2회, 인자 수정 최대 2회, 전체 기본 60초 제한이다. 최적화 후에는 새 검증을 받아야 완료된다. 미확인 제약은 확인된 만족으로 설명하지 않는다.

trace는 모델 ID·프롬프트 해시·설정·실제 도구 호출·결과 상태·제공자가 반환한 token usage를 구분한다. API 키와 사용자 JWT를 도구 인자나 trace에 기록하지 않는다. 모델 요금은 이 코드에서 임의로 추정하지 않는다.

## 평가와 채택 판단

[고정 실행 결과](./evidence/optimization-offline-2026-10-18.json)는 개발 20건·평가 10건의 **합성 사례**와 고정 방향별 ETA 행렬을 사용한다. 실제 ConstraintEngine/ScheduleConstraint를 호출하되 timeline reflow는 fixture용 adapter다. B는 추출한 근접 정렬 기준이고 D는 동일 항목의 제한 탐색이다. 전체 원본 PlannerService 재실행을 뜻하지 않는다. 개발/평가 사례가 같은 시나리오 템플릿을 공유하므로 독립적인 실제 여행 평가 표본도 아니다.

| 전체 30건 | B | D |
| --- | ---: | ---: |
| 확인된 위반이 없는 일정 | 18 | 24 |
| 미확인 조건도 없는 일정 | 15 | 21 |
| 잠금 포함 사례 보존 | 6/6 | 6/6 |
| 필수 누락 / 항목 손실 | 0 / 0 | 0 / 0 |
| 목표 부족 합 | 15 | 15 |
| 평가 횟수 | 30 | 882 |

같은 30건을 짝지어 비교하면 유효성 개선 6건, 악화 0건, 양쪽 모두 무효 6건이다. 양쪽 모두 유효하고 ETA를 아는 18건에서는 이동 개선 15건·동일 3건·악화 0건이며, 같은 18건의 이동 합은 4,299분에서 2,094분이다. 이 비교도 합성 ETA 행렬에서만 성립한다.

모든 실패·미확인 사례를 분모에 포함했다. 이동 합은 유효 일정 집합의 크기가 서로 다르므로 보고서의 개별 사례·비교 가능한 동일 사례를 보고 해석해야 한다. 오프라인 routeCalls는 fixture 함수 호출 수이며 생산 API의 공유 조회 캐시/128회 제한이나 외부 호출 비용을 나타내지 않는다.

A 전체 변경 전 실행 재현과 C 실제 모델 Agent 비교는 `not_run`이다. 실제 여행 자료 30건, 모델 최소 3회 반복, live 경로 smoke, 비용·지연·실패율 비교, 제한 배포·되돌리기 실험은 아직 수행하지 않았다. 따라서 이 수치만으로 새 경로를 기본 채택하지 않는다.

## 실행과 되돌리기

공유 타입 산출물이 오래되었으면 먼저 빌드한다.

```sh
pnpm --filter @tripick/types build
pnpm --filter @tripick/utils build
pnpm --filter @tripick/api typecheck
pnpm --filter @tripick/api exec jest --runInBand test/planner test/replanning test/itinerary
pnpm --filter @tripick/api eval:planning -- --output=/absolute/path/report.json
PYTHONPATH=tools/planning-agent python3 -m unittest discover -s tools/planning-agent/tests -v
```

Redis 저장·만료·동시 lease·후보 수 상한 테스트는 격리된 Redis를 띄운 뒤 `PLANNING_REDIS_TEST_PORT=<port>`를 지정해 `test/planner/tools/planning-snapshot.store.spec.ts`를 실행한다. 일반 테스트는 이 외부 서비스 테스트를 건너뛴다. 2026-10-18에는 실제 격리 Redis로 세 항목을 통과시켰다.

이번 검증에서 API 전체 단위 테스트 95 suites / 1,208 tests, Python 34 tests, API typecheck/build, 수정 범위 ESLint가 통과했다. 실행 환경은 Node 23.10.0, Redis 8.0.1이며 저장소가 요구하는 운영 Node 버전은 24.3.0 이상이다. 최초 전체 실행의 취소 회귀와 다른 HTTP 테스트의 일시적 socket 실패는 후속 전체 실행에서 모두 통과했다. 실제 모델·실제 여행 DB·외부 경로 API 검증과는 구분한다. 게시 전 최신 main에 이번 변경만 합친 격리 checkout에서도 API 1,199개 통과·Redis opt-in 3개 건너뜀, Python 34개, 타입 검사·빌드를 다시 확인했다. 앞의 1,208개 기록은 다른 병행 변경까지 있던 원래 작업 폴더의 결과다.

개발 또는 제한된 환경에서만 `PLANNING_TOOLS_ENABLED=true`를 지정한다. 탐색도 켜려면 `PLANNING_LOCAL_SEARCH_ENABLED=true`를 별도로 지정한다. 되돌릴 때 탐색 플래그를 끄면 신규 최적화 요청은 404이고 기존 생성 경로가 그대로 동작한다. API 플래그까지 끄면 네 도구 모두 비활성이다. 이 API는 영속 일정을 저장하지 않으므로 되돌릴 신규 itinerary 저장 이력이나 진행 중 worker job은 없다. Redis snapshot·candidate는 TTL로 정리된다.
