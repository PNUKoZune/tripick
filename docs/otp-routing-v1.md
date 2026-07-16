# OTP 길찾기 전환 v1

문서 목적: 경로·ETA 계산을 외부 API(TMAP/ODsay)에서 자체 호스팅 OTP2(OpenTripPlanner)로 전환하고, 이를 일정 생성·재계획·Live 화면에 연결한 작업을 고정한다. GTFS(대중교통)+OSM(자동차/도보)을 하나의 그래프로 빌드해 자동차·대중교통 경로를 동일 인터페이스로 조회한다.

기준 브랜치: `feat/otp-routing`
관련 문서: [`docs/main-planner-v1.md`](./main-planner-v1.md), [`docs/trip-progress-live-v1.md`](./trip-progress-live-v1.md), [`CLAUDE.md`](../CLAUDE.md) 6절(외부 API 연동)

커밋: `1f75afb`(인프라) → `c60983f`(ETA 전환) → `ebb31e1`(Live 폴링) → `1fd9dd5`(UI 툴팁)

## 1. 범위

포함:

- OTP2 도커 스택(`otp-build`/`otp`)을 `docker-compose` 에 추가 (compose `profiles` 로 기본 up 과 분리)
- `RouteHelper` 를 OTP GraphQL 질의로 교체 — 자동차 CAR / 대중교통 TRANSIT+WALK / 도보 WALK,
  `getEta(from, to, mode, departAt)` 로 정본 `transportMode` 분기
- 대중교통 시간표 왜곡 방지: 계획상 출발 시각(`departAt`)을 KST date/time 으로 전달
- Live 화면: `GET /routes/eta` 신설 + 현재 위치→다음 장소 60초 폴링, 실패 시 직선거리 휴리스틱 폴백
- 이동시간 추정치 UI 에 "실시간 교통 미반영" info 툴팁

제외:

- React Native(mobile) 적용
- 실시간 교통량 반영 (OTP 는 GTFS 시간표 기반, 도로 혼잡 미반영)
- OTP 서버 프로덕션 배포/오케스트레이션 (로컬 테스트 스택)
- 도보 전용(WALK-only) 별도 모드 — 대중교통 조회에 도보 leg 로 포함

## 2. 인프라 (도커)

`infra/otp/data/` 에 입력·설정·산출물을 두고 컨테이너 `/var/opentripplanner` 로 마운트한다. 자세한 실행 절차는 [`infra/otp/README.md`](../infra/otp/README.md).

| 서비스 | command | profile | 힙 기본값 | 용도 |
| ------ | ------- | ------- | -------- | ---- |
| `otp-build` | `--build --save` | `otp-build` | `13g` | GTFS+OSM → `graph.obj` 빌드 (1회성) |
| `otp` | `--load --serve` | `otp` | `10g` | 그래프 로딩 후 서빙 (호스트 `8090`→컨테이너 `8080`) |

- 이미지: `opentripplanner/opentripplanner:2.9.0` (고정)
- 포트 `8090` — LLM 서버(`8080`)와 충돌 회피
- 힙은 `OTP_MAX_HEAP` 로 조정. 권역만 다루면 낮춰도 됨
- GraphQL 엔드포인트: `http://localhost:8090/otp/gtfs/v1`

### 전국 데이터 실측 메모리 요건 (물리 16GB 기준 빡빡)

- 빌드: `stop_times` 매핑 피크 때문에 **13g** 필요 (8g 는 OOM). 소요 ~11분, `graph.obj` ~1.3GB
- 서빙: graph.obj 로딩 + Raptor 인덱스에 **10g** 상주 (실측 ~10.6GiB)
- 전국 서빙 중엔 LLM 등과 동시 구동이 어려움 → 실사용은 권역 축소/별도 머신 고려
- **GTFS zip 은 루트에 `agency.txt` 등이 바로 있어야** OTP 가 인식 (폴더 한 겹 있으면 실패, 재포장 필요). OTP 는 데이터 폴더의 모든 `.zip` 을 읽으므로 백업 zip 을 data 폴더에 두면 안 됨

## 3. 데이터 흐름

### 3-1. 일정 생성/재계획 ETA (백엔드)

```
planner.service.estimateTravelTime(from, to, mode, currentAt)      # 이전 장소 출발 시각
main-planner.travelMinutes(trip, from, to, departureFrom(item))     # 항목 종료 시각
constraint.engine.validate(...) → getDrivingEta/TransitEta(.., currentEnd)
  → RouteHelper.queryOtp(from, to, modes, departAt)
      → POST {OTP_BASE_URL}/otp/gtfs/v1  (GraphQL plan)
          ├ 성공 → { durationSec, distanceM(=leg 거리 합) }
          └ 실패/경로없음/타임아웃(5s) → 직선거리 로컬 추정 폴백
```

- `departAt` 이 있으면 KST `date`/`time` 인자를 붙여 시간표 기반으로 조회 (밤/새벽 왜곡 방지)

### 3-2. Live 화면 ETA (프론트 폴링)

```
[web] TripProgressView → useLiveEta({ position, next, transportLabel })
  → 60초 refetchInterval (Live·GPS·다음장소 있을 때만 enabled, 좌표 4자리 양자화)
  → GET /api/v1/routes/eta?fromLat&fromLng&toLat&toLng&mode
      → RouteController → RouteHelper (departAt 생략 = 현재 시각)
  → NextStopBar: OTP ETA 우선 표시, 없으면 estimate-eta 휴리스틱 폴백
```

## 4. 붙인 지점

| 레이어 | 파일 | 변경 |
| ------ | ---- | ---- |
| infra | [`docker-compose.yml`](../docker-compose.yml) | `otp-build`/`otp` 서비스, profile 분리 |
| infra | [`infra/otp/README.md`](../infra/otp/README.md) | 데이터 위치·실행·메모리 요건·질의 예시 |
| api (helper) | [`apps/api/src/planner/helpers/route.helper.ts`](../apps/api/src/planner/helpers/route.helper.ts) | TMAP/ODsay → OTP GraphQL, `departAt` KST 변환, 폴백 유지 |
| api (planner) | [`apps/api/src/planner/planner.service.ts`](../apps/api/src/planner/planner.service.ts) | `estimateTravelTime(.., departAt=currentAt)` |
| api (main-planner) | [`apps/api/src/main-planner/main-planner.service.ts`](../apps/api/src/main-planner/main-planner.service.ts) | `travelMinutes(.., departAt)` + `departureFrom` 헬퍼 |
| api (constraint) | [`apps/api/src/planner/constraint/constraint.engine.ts`](../apps/api/src/planner/constraint/constraint.engine.ts) | `currentEnd` 를 departAt 으로 전달 |
| api (controller) | [`apps/api/src/planner/route.controller.ts`](../apps/api/src/planner/route.controller.ts) | `GET /routes/eta` 신설, RouteHelper 재사용 |
| api (module) | [`apps/api/src/planner/planner.module.ts`](../apps/api/src/planner/planner.module.ts) | `RouteController` 등록 |
| types | [`packages/types/src/route.ts`](../packages/types/src/route.ts) | `RouteEtaDto`/`RouteTransportMode` |
| web (feature) | [`apps/web/src/features/track-trip-progress/model/use-live-eta.ts`](../apps/web/src/features/track-trip-progress/model/use-live-eta.ts) | 60초 폴링 훅 |
| web (ui) | [`apps/web/src/features/track-trip-progress/ui/next-stop-bar.tsx`](../apps/web/src/features/track-trip-progress/ui/next-stop-bar.tsx) | OTP ETA 우선 표시 + info 툴팁 |
| web (widget) | [`apps/web/src/widgets/trip-info-panel/ui/trip-info-panel.tsx`](../apps/web/src/widgets/trip-info-panel/ui/trip-info-panel.tsx) | "예상 이동 km" 툴팁, WeatherHint → InfoTooltip |
| web (shared) | [`apps/web/src/shared/ui/info-tooltip.tsx`](../apps/web/src/shared/ui/info-tooltip.tsx) | 공유 `InfoTooltip` 컴포넌트 |
| env | [`apps/api/.env.example`](../apps/api/.env.example) | `TMAP_API_KEY`/`ODSAY_API_KEY` 제거, `OTP_BASE_URL` 추가 |

## 5. 환경변수

- `OTP_BASE_URL` (기본 `http://localhost:8090`): 미설정/미가동 시 RouteHelper 가 직선거리 추정으로 폴백하므로 OTP 없이도 서버는 동작
- `OTP_MAX_HEAP`: 빌드/서빙 힙 오버라이드 (compose 기본값 빌드 13g / 서빙 10g)

## 6. 검증

```bash
pnpm --filter @tripick/types build
cd apps/api && npx tsc --noEmit
cd apps/web && npx tsc --noEmit
cd apps/api && npx jest test/planner test/main-planner
```

- 타입체크(types 빌드·api·web) 통과, planner/main-planner 테스트 50개 통과 (2026-07-14 기준)
- `route.helper.spec.ts` — OTP 질의/폴백/출발시각 케이스 재작성 (10개)
- 실가동 OTP 관통 검증(임시 스펙, 이후 삭제):
  - CAR 서울시청→홍대 382초/6781m, TRANSIT 1335초/5476m, 잘못된 좌표 400
  - 시각 인자 반영 확인 — 09:00 vs 03:00 대중교통 결과 상이
- `next lint` 는 현 Next 버전에서 서브커맨드 미동작(기존 이슈) → typecheck 로 대체
- Live 화면 info 툴팁은 브라우저 hover 렌더 미확인 (인증+진행중 여행 데이터 필요)

## 6-1. 리뷰 후 보강 (커밋 `64d4faf`, `700c1b0`)

self-review 에서 나온 결함을 수정했다. 설계 의도가 코드에 안 지켜지고 있던 것들이라 기록해 둔다.

| # | 결함 | 수정 |
| - | ---- | ---- |
| 1 | `useLiveEta` 의 queryKey 에 GPS 좌표가 있어 11m 이동마다 새 키 → 캐시 미스 → 즉시 재조회. `refetchInterval` 이 무력해 이동 중 최대 60배 요청 | 키를 목적지+수단으로 고정, 위치는 `ref` 로 읽어 폴링 주기가 실제 상한이 되게 함 |
| 2 | 표시용 한글 라벨을 부분문자열로 역추론해 `'도보 중심'` 이 transit 으로 붕괴 (라벨을 `'자가용'` 으로 바꾸면 car 도 조용히 깨짐) | `PlannerTripMetaDto.transportMode` (정본) 추가, `getWalkingEta`/`getEta` 로 walk 를 WALK 로 조회 |
| 3 | Live 스크롤 컨테이너 최상단에서 위로 뜨는 툴팁이 클리핑 | `InfoTooltip` 에 `side` prop, NextStopBar 는 아래로 |
| 4 | 폴백 거리가 경도 1도=88km 고정 근사 (위도 37.5° 전용) — 제주에서 5% 이상 오차 | `@tripick/utils` 의 `haversineMeters` 재사용 |
| 6 | 폴백이 조용히 섞여 추정치가 실경로처럼 서빙됨 | `EtaResult`/`RouteEtaDto` 에 `source: 'otp' \| 'estimate'` 노출, `OTP_BASE_URL` 미설정 시 1회 warn |
| 7 | 훅의 `distanceM` 미사용 + 화면이 경로시간과 직선거리를 섞어 표시 | 시간·거리를 같은 출처끼리 짝지어 표시, `source=estimate` 면 클라 휴리스틱 사용 |
| 8 | 좌표 범위·mode 미검증 → `lat=999` 가 가짜 ETA 200 으로 응답 | mode 화이트리스트 + 위경도 범위 검증 → 400 |

`source` 도입 배경: OTP 콜드 스타트 1회가 5s axios 타임아웃을 넘겨 폴백된 적이 있는데
(직선거리 ÷ 폴백속도 값이 그대로 나옴), 응답만 보고는 실경로인지 구분할 수 없었다.

## 7. 알려진 제한 / 후속

- OTP 는 GTFS 시간표 기반이라 **실시간 교통량(도로 혼잡)은 미반영** → UI 에 info 툴팁으로 안내, "지도 길찾기로 정확히 확인" 유도
- 전국 그래프는 16GB 물리 메모리에 빡빡 — 실사용은 권역 샤딩(경계 넘는 경로 손실 주의) 또는 RAM 증설 필요
- Live 폴링은 60초/사용자 1회 — OTP 단일 인스턴스 동시성 부하는 사용자 수 증가 시 재검토
- **좌표쌍 ETA 캐싱 미적용** — 일정 1건 생성에 9~45회를 순차 호출한다. `WeatherHelper` 의
  Redis 캐시 패턴을 좌표쌍+모드+출발시각 버킷 키로 적용하고, 독립 구간은 `Promise.all` 로
  묶는 것이 다음 과제 (이 작업의 원래 출발점이었다)
- OTP 콜드 스타트 첫 질의가 5s 타임아웃을 넘겨 1회 폴백될 수 있음 (워밍업 후 WALK 169ms /
  CAR 53ms / TRANSIT 1265ms). `source=estimate` 로 식별 가능하며 자동 회복된다
- `graph.obj`·GTFS·OSM 대용량 파일은 커밋 제외(gitignore), 각자 로컬에서 빌드
- GTFS 데이터 품질(정류장 좌표, 노선 커버리지)에 결과가 좌우됨 — 피드 갱신 주기 관리 필요
