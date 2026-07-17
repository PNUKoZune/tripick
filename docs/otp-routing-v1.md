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
| `otp` | `--load --serve` | `otp` | `13g` | 그래프 로딩 후 서빙 (호스트 `8090`→컨테이너 `8080`) |

- 이미지: `opentripplanner/opentripplanner:2.9.0` (고정)
- 포트 `8090` — LLM 서버(`8080`)와 충돌 회피
- 힙은 `OTP_MAX_HEAP` 로 조정. 권역만 다루면 낮춰도 됨
- GraphQL 엔드포인트: `http://localhost:8090/otp/gtfs/v1`

### 전국 데이터 실측 메모리 요건 (물리 16GB 기준 빡빡)

- 빌드: `stop_times` 매핑 피크 때문에 **13g** 필요 (8g 는 OOM). 소요 ~11분, `graph.obj` ~1.3GB
- 서빙: 그래프 로딩만으로 힙을 **~10.5GiB** 채운다. 10g 를 주면 검색할 여유가 없어 GC 가
  폭주하므로 **13g 이상**이 필요하다 (6-3 참고). 13g 는 물리 16GB 에서 커널 OOM 킬을 맞으니
  로컬은 권역 그래프를 권장
- 전국 서빙 중엔 LLM 등과 동시 구동 불가 → 별도 머신/RAM 증설 또는 권역 축소
- **GTFS zip 은 루트에 `agency.txt` 등이 바로 있어야** OTP 가 인식 (폴더 한 겹 있으면 실패, 재포장 필요). OTP 는 데이터 폴더의 모든 `.zip` 을 읽으므로 백업 zip 을 data 폴더에 두면 안 됨

## 3. 데이터 흐름

### 3-1. 일정 생성/재계획 ETA (백엔드)

```
planner.service.estimateTravelTime(from, to, mode, currentAt)      # 이전 장소 출발 시각
main-planner.travelMinutes(trip, from, to, departureFrom(item))     # 항목 종료 시각
constraint.engine.validate(...) → getDrivingEta/TransitEta(.., currentEnd)
  → RouteHelper.getEta(from, to, mode, departAt)
      ├ Redis 캐시 hit → 즉시 반환 (departAt 있는 질의만 캐싱)
      └ miss → POST {OTP_BASE_URL}/otp/gtfs/v1  (GraphQL plan)
          ├ 성공 → { durationSec, distanceM(=leg 거리 합), source:'otp' } → 캐시 저장
          └ 실패/경로없음/타임아웃(15s) → 직선거리 추정 (source:'estimate', 캐시 안 함)
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
- `OTP_MAX_HEAP`: 빌드/서빙 힙 오버라이드 (compose 기본값 둘 다 13g). 권역 그래프면 낮추고,
  로컬 16GB 에서 전국을 띄워야 하면 10g 로 낮추되 동시 transit 질의가 붕괴함을 감수 (6-3)

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

## 6-2. ETA 캐싱 (Redis)

`WeatherHelper` 와 같은 인라인 ioredis 패턴. 일정 1건 생성이 같은 구간을 여러 번(제약 검증
재시도 등) 조회하므로 적중률이 높다.

- 키: `route:eta:{mode}:{lat,lng}:{lat,lng}:{departAt|any}` — 좌표는 소수 5자리(~1m)로 정규화
- TTL: **6시간** (같은 그래프면 결과가 결정적)
- **departAt 이 있는 질의만 캐싱**. 없으면 OTP 가 "현재 시각"으로 계산해 결과가 벽시계에
  의존하는데, 이를 캐싱하면 Live 폴링 ETA 가 얼어붙어 폴링이 무의미해진다
- **`source='estimate'`(폴백)는 캐싱하지 않는다** — OTP 장애가 지나가도 나쁜 추정치가 TTL 동안 박제된다
- `car`/`walk` 는 OTP 에 교통량 모델이 없어 시각과 무관 → 키에서 출발시각을 빼 적중률을 높인다.
  `transit` 만 시간표에 의존하므로 분 단위 출발시각을 키에 넣는다(10분 버킷 같은 근사는
  09:00 의 답을 09:09 질의에 주게 되어 틀린 값이 된다)
- Redis 장애는 조회를 막지 않는다 (read/write 전부 try/catch, `lazyConnect`+`enableOfflineQueue:false`)

실측 (서울 시내 4구간, 미워밍 날짜): **콜드 11.3초 → 캐시 적중 2ms**.

## 6-3. ⚠️ 서빙 힙 부족이 동시성을 무너뜨린다 (한 번 오진했던 부분)

**결론부터**: OTP 는 동시 질의를 정상 처리한다. 아래 붕괴는 **서빙 힙 부족(GC 폭주)** 이
원인이며, OTP 나 HTTP 스레드의 한계가 아니다.

작업 중간에 "OTP 는 동시 Raptor 질의를 감당하지 못한다"고 결론내고 세마포어로 직렬화했으나,
**오진이었다.** 측정만 하고 원인을 파고들지 않은 탓이다. 같은 실수를 반복하지 않도록 근거를
남긴다.

### 관측

10g 힙(전국 그래프)에서 같은 4구간:

| | 소요 |
| - | ---- |
| 순차 | 7.5초 |
| 병렬(`Promise.all`) | **80초** — 10배 느리고 타임아웃과 겹쳐 전부 폴백 |

### 오진을 깬 근거 3가지

1. **CAR 병렬 4건은 10g 에서도 140ms** (단건 56ms). Raptor 를 쓰지 않는 경로는 멀쩡하다 →
   OTP 전역 문제도, HTTP 스레드 풀(15개) 한계도 아니다.
2. **전국 그래프는 로딩만으로 힙을 ~10.5GiB 채운다.** 질의 0건 상태에서 이미 10g 가 꽉 찬다
   → 검색에 쓸 여유가 없어 매 할당이 GC 를 부르고, 10GB live set 을 스캔하는 full GC 가
   반복된다.
3. **13g 로 올리자 병렬이 순차보다 빨라졌다** (아래 표). 세마포어 없이도 정상.

### 힙별 실측 (같은 4구간, 워밍된 날짜)

| 힙 | 순차 4건 | 병렬 4건 | 병렬 8건 | 안정성 |
| -- | -------- | -------- | -------- | ------ |
| 10g | 8.15초 | **80.9초** | — | 안정 |
| 13g | 1.62초 | **1.35초** | 10.0초 (swap 진입) | **16GB 머신에선 커널 OOM 킬** |

힙을 올리면 순차도 5배 빨라진다(8.15→1.62초). 즉 GC 압박이 모든 질의를 느리게 만들고 있었다.
"날짜당 첫 질의 ~3초"도 힙이 넉넉하면 ~1.8초다.

### 결정

- **세마포어는 제거**했다. 힙만 충분하면 불필요한 직렬화이고, 근본 원인을 가리는 밴드에이드였다.
- **서빙 힙 기본값을 13g** 로 올렸다. 배포 머신은 메모리를 충분히 잡는 전제다.
- `constraint.engine`·`recomputeDayTravelTimes` 는 여전히 순차다. 다만 이유가 다르다 —
  "OTP 가 못 견뎌서"가 아니라, 힙이 넉넉할 때 이득이 근소한 반면(1.62초 vs 1.35초) 동시
  사용자가 겹칠 때 부하만 배로 키우기 때문이다.

> BullMQ 로 ETA 큐를 만드는 방안도 검토했으나 채택하지 않았다. (동시성 제한이 필요했던 시점의
> 검토였고, 지금은 제한 자체가 불필요하다.) 잡 큐는 스케줄링·재시도·영속성 도구이고,
> `defaultJobOptions` 의 `attempts:3, backoff:2000` 은 사용자가 기다리는 동기 읽기에 맞지 않으며,
> `waitUntilFinished` 는 HTTP 요청이 잡 완료를 붙잡고 `QueueEvents` 용 Redis 연결도 늘어난다.

### ⚠️ 로컬 16GB 머신에서는 13g 가 뜨지 않는다

전국 그래프 + 13g 는 물리 16GB(WSL2 ~15.4GiB)에서 **커널 OOM 킬**을 맞는다 (실측:
`Out of memory: Killed process (java) anon-rss:11419252kB`, `restart: unless-stopped` 로 자동 재기동).
로컬에서 전국 그래프를 다뤄야 하면 둘 중 하나:

- `OTP_MAX_HEAP=10g` 로 낮춘다 → 안정적이지만 동시 transit 질의가 붕괴하므로 순차 사용만
- **권역(수도권 등)으로 잘라 빌드한다** → 힙이 작아져 동시성·안정성 모두 확보 (권장)

## 7. 알려진 제한 / 후속

- OTP 는 GTFS 시간표 기반이라 **실시간 교통량(도로 혼잡)은 미반영** → UI 에 info 툴팁으로 안내, "지도 길찾기로 정확히 확인" 유도
- **전국 그래프는 서빙에 13g 이상이 필요**하고 물리 16GB 로컬에선 OOM 킬을 맞는다 (6-3).
  배포는 메모리를 넉넉히 잡는 전제이며, 로컬 개발은 권역 그래프 사용을 권장
- 동시 사용자가 늘 때의 처리량은 미검증 — 13g 에서 병렬 8건이 10초(swap 진입)까지 늘었다.
  스케일아웃은 OTP 인스턴스를 늘리는 방향 (앞단 직렬화는 힙이 충분하면 불필요)
- 일정 1건 생성은 캐시 미스 시 9~45회를 순차 조회한다. 힙이 충분하면 구간당 ~1초 수준이지만
  일정 규모에 따라 지연이 선형으로 늘어난다 — BullMQ 비동기 처리 검토 필요
- 날짜별 첫 질의(~1.8초)는 lazy 레이어 빌드 탓 — 자주 쓰는 날짜를 미리 워밍하는 것도 방법
- `graph.obj`·GTFS·OSM 대용량 파일은 커밋 제외(gitignore), 각자 로컬에서 빌드
- GTFS 데이터 품질(정류장 좌표, 노선 커버리지)에 결과가 좌우됨 — 피드 갱신 주기 관리 필요
