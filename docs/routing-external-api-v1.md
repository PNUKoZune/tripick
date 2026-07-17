# 길찾기 외부 API 전환 v1

문서 목적: 경로·ETA 계산을 자체 호스팅 OTP2 대신 외부 API(카카오 모빌리티 + ODsay)로 완성한 작업을 고정한다. 그 과정에서 이 코드가 **한 번도 외부 API 값을 쓴 적이 없었다**는 사실이 드러나, 원인 버그와 견고성 이슈를 함께 고쳤다.

기준 브랜치: `feat/routing-external-api`
관련 문서: [`docs/main-planner-v1.md`](./main-planner-v1.md), [`CLAUDE.md`](../CLAUDE.md) 6절 (길찾기 API 주의사항)

커밋: `2ac4323`(실연동) → `f6ad136`(Redis 캐싱) → `9317e35`(도보·견고성) → `34c0cf5`(CLAUDE.md)

## 1. 범위

포함:

- 자동차 ETA 를 **카카오 모빌리티 길찾기**로 실연동 (TMAP 제거)
- 대중교통 ETA 를 **ODsay** 로 실연동 (인증·단위 버그 수정)
- 도보 ETA 를 거리 기반 로컬 추정으로 신설
- ETA **Redis 캐싱** + 동시 요청 병합
- 이동 수단 정본 타입 `RouteMode` 도입, 분기 3곳 전환

제외:

- **OTP2 자체 호스팅** — 폐기. `feat/otp-routing` 은 머지하지 않는다 (2절)
- `departAt`(출발 시각) 반영 — 모든 질의가 암묵적으로 "지금" 기준 (9절)
- Live 화면 ETA 폴링, `GET /routes/eta` 컨트롤러 — OTP 브랜치와 함께 폐기
- React Native 적용

## 2. 왜 OTP2 가 아니라 외부 API 인가

`feat/otp-routing` 이 GTFS+OSM 을 단일 그래프로 빌드해 자동차·대중교통·도보를 통합 조회하도록 만들어 뒀으나 폐기했다.

**폐기 사유: 자동차 ETA 정확도 부족.** OTP 는 GTFS 시간표와 OSM 도로망만 보고 계산해 **실시간 교통 상황을 반영하지 못한다.** 도로 혼잡을 모르는 자동차 ETA 는 국내 도심에서 실제와 크게 어긋나고, TriPick 은 그 ETA 로 일정을 짜고 재계획까지 하므로 오차가 그대로 일정 붕괴로 이어진다. OTP 브랜치 자신도 이 한계를 알고 있어서 "실시간 교통 미반영" info 툴팁을 UI 에 달아야 했다 — 정확도를 UI 로 해명해야 하는 상태였다.

카카오 모빌리티 길찾기는 실시간 교통을 반영한다. 그래서 자동차 ETA 캐시 TTL 을 1시간으로 짧게 잡는다(6절) — 오래 캐싱하면 전환 이유가 무의미해진다.

외부 API 로 돌아오면서 잃은 것과 얻은 것:

| | OTP2 | 외부 API (현재) |
| --- | --- | --- |
| **자동차 실시간 교통** | **미반영** (전환 사유) | **반영** (카카오 모빌리티) |
| 도보 경로 | 실경로 | 직선거리 추정 (5절) |
| 출발 시각 반영 | `departAt` 지원 | 미지원 (11절) |
| 호출 비용 | 없음 (자체 호스팅) | 쿼터 있음 → 캐싱 필수 (6절) |

자체 호스팅을 걷어내면서 부수적으로 인프라 부담(전국 그래프 서빙에 힙 13g, 로컬에서 LLM 과 동시 구동 불가)도 사라졌다. 실측은 폐기된 브랜치의 `docs/otp-routing-v1.md` 에 남아 있다 — OTP 를 다시 검토할 일이 생기면 그 문서부터 볼 것.

## 3. 이 코드는 한 번도 외부 API 값을 쓰지 않았다

작업의 출발점이자 가장 중요한 발견. 자동차·대중교통 **양쪽 모두** 조용히 로컬 추정치(직선거리 ÷ 실효속도)로 폴백하고 있었고, 폴백이 실패를 삼켜 몇 달간 드러나지 않았다.

- **자동차**: `TMAP_API_KEY` 가 발급된 적이 없다. 키가 비어 있으니 항상 폴백.
- **대중교통**: ODsay 가 `Referer` 헤더를 요구하는데 보내지 않아 항상 `ApiKeyAuthFailed`. `catch` 가 이를 삼키고 폴백.

교훈: `buildLocalEstimate` 폴백은 장애를 **가린다**. 이동시간이 이상하면 "진짜 API 값이 맞나"부터 의심할 것.

## 4. 두 API 의 함정

### 4-1. ODsay 는 Referer 헤더가 필수

키 발급 시 등록한 서비스 URL 을 `Referer` 로 검증한다. 헤더가 없으면 **HTTP 200 + `[ApiKeyAuthFailed]`**.

```
Referer 없음            → {"error":[{"code":"500","message":"[ApiKeyAuthFailed] ..."}]}
Referer: localhost:4000 → 정상 경로 응답
```

키 인코딩 문제가 아니다(raw·pre-encoded 모두 동일하게 실패, Referer 만 붙이면 통과). `ODSAY_SERVICE_URL` 로 주입하며 등록 도메인과 정확히 일치해야 한다.

### 4-2. 두 API 모두 길찾기 실패를 HTTP 200 본문으로 준다

axios 가 던지지 않으므로 **`catch` 로는 절대 안 잡힌다**. 응답 본문을 직접 검사해야 한다.

| API | 실패 표현 | 성공 조건 |
| --- | --- | --- |
| 카카오 모빌리티 | `routes[].result_code` | `0` |
| ODsay | `error[]` 배열 존재 | 배열 없음 |

카카오 `result_code: 104`(출발지·도착지 5m 이내)는 **실패가 아니라 "이동 없음"** 이다. 폴백의 최소 10분을 씌우면 일정에 없는 이동이 생기므로 `{durationSec: 0, distanceM: 0}` 으로 처리한다.

### 4-3. 좌표 순서와 단위

| API | 좌표 | 시간 | 거리 |
| --- | --- | --- | --- |
| 카카오 모빌리티 | `origin=x,y` = **경도,위도** | `summary.duration` = **초** | `summary.distance` = **미터** |
| ODsay | `SX/SY`, `EX/EY` | `totalTime` = **분** | `totalDistance` = **미터** |

기존 코드가 ODsay `totalDistance` 를 km 로 보고 1000 을 곱하고 있었다 — 시청→강남역 10,764m 가 **10,764km** 로 계산됐다. 인증 실패로 폴백만 타서 가려져 있었고, Referer 만 고쳤으면 이 버그가 그대로 살아났다.

카카오 모빌리티는 **기존 `KAKAO_REST_API_KEY` 를 그대로 쓴다** (OAuth·로컬 API 와 공용, 별도 발급·활용신청 불필요).

## 5. 도보는 왜 로컬 추정인가

도보 실경로를 주는 국내 API 가 마땅치 않아 거리 기반 추정으로 간다. 이 파일의 추정 모델은 **직선거리 ÷ 실효속도**이고, 실효속도는 실주행 속도가 아니라 우회를 반영한 값이다.

| 수단 | 실효속도 | 근거 |
| --- | --- | --- |
| car | 28 km/h | 기존값 (폴백 전용) |
| transit | 20 km/h | 기존값 (폴백 전용) |
| walk | **3.5 km/h** | 도보 4.5km/h × 우회 1.3배. 폴백이 아닌 **정식 추정 모델** |

최소 이동시간도 수단별로 나눈다. 폴백(car/transit)은 거리밖에 모르니 보수적으로 **10분**을 깔지만, 도보는 거리 기반 추정이 곧 정답이라 **1분**만 깐다. 그러지 않으면 300m 도보가 10분으로 부풀어 없는 이동이 생긴다.

## 6. ETA 캐싱

외부 API 라 호출량을 최소화해야 한다. `weather.helper` 와 같은 ioredis 구성(`lazyConnect`, 에러 무시)을 따른다.

```
route:eta:{mode}:{lat,lng}:{lat,lng}     좌표 5자리 ≈ 1m
```

- **수단별·방향별 분리** — A→B 와 B→A 는 일방통행 때문에 다를 수 있다.
- **TTL 을 수단별로 나눈다**: 카카오 모빌리티는 실시간 교통을 반영해 오래 캐싱하면 값이 무의미해지므로 **1시간**, ODsay 는 시간표 기반이라 **12시간**. walk 는 API 를 안 타므로 캐싱 대상이 아니다.
- **폴백은 캐싱하지 않는다** — 캐싱하면 API 장애가 지나간 뒤에도 나쁜 값이 TTL 동안 박제되어 여파가 장애보다 길어진다.
- **캐시 값은 shape 를 검증**한다 — `EtaResult` 형태가 바뀌면 이전 형식 키가 TTL 동안 남아, 믿고 쓰면 `undefined` 가 호출부 산술로 흘러 NaN 이 된다.
- **동시 요청 병합** — 캐시는 응답이 온 뒤에야 채워지므로, 병합이 없으면 콜드 구간에서 동시 요청이 전부 API 를 친다(호출량 최소화라는 캐싱 목적이 정작 그 지점에서 깨진다). 프로세스 내에서만 병합되며, 인스턴스 간 중복은 TTL 로만 줄어든다.

## 7. 같이 고친 버그 / 견고성

### 버그

- **도보 여행이 대중교통 ETA 를 받았다.** `transportMode` 는 `walk|transit|car` 3값인데 분기가 "car 면 자동차, 아니면 대중교통" 2분기라 walk 가 `else` 로 떨어졌다. 시청→강남역이 버스 40분으로 계산됐으나 실제 도보는 150분 — 걸어서 갈 수 없는 일정이 Constraint Engine 을 경고 없이 통과했다. ODsay 키가 없어 폴백을 타도 시속 20km(대중교통 속도)라 똑같이 틀렸다.
- **ODsay `totalDistance` 단위 오해** (4-3).
- **폴백 거리의 경도 상수가 88km 로 고정** — 위도 37.5°(서울) 기준값이라 제주(33.5°)에서 동서 거리를 약 5% 짧게 봤다. 두 지점 중간 위도의 `cos` 로 보정.

### 견고성

- HTTP 200 본문의 실패 검사 (4-2), 10초 타임아웃 추가.
- 설정 누락 warn 을 키별 1회로 제한 — 일정당 좌표쌍마다 반복돼 로그가 도배됐다.
- 구간 ETA 를 순차 `await` → `Promise.all` 병렬화. 구간끼리 의존이 없는데 캐시 미스 시 왕복이 구간 수만큼 직렬로 쌓여 `createTrip` 이 늦어졌다.

### 이동 수단 유니온 중복이 walk 버그의 진짜 원인

`'walk' | 'transit' | 'car'` 가 5곳에 인라인으로 복사돼 있어, 호출부가 walk 를 transit 으로 흘려보내도 **타입 검사가 못 잡았다**. 정본 `RouteMode` 를 `packages/types/src/trip.ts` 에 두고 공유하며, `RouteHelper.getEta` 의 `switch` 가 exhaustive 검사로 분기 누락을 막는다. 이제 수단을 추가하면 컴파일이 깨진다.

## 8. 붙인 지점

```
RouteHelper.getEta(from, to, mode)          # 정본 RouteMode 로 분기
 ├ Redis 캐시 hit → 즉시 반환
 ├ in-flight 병합 → 동시 동일 조회는 1건으로
 ├ car     → 카카오 모빌리티 /v1/directions
 ├ transit → ODsay /searchPubTransPathT (Referer 필수)
 └ walk    → 로컬 추정 (외부 호출 없음)

호출부
 ├ constraint.engine.validate(...)          # 구간 ETA 병렬 조회
 ├ planner.service.estimateTravelTime(...)
 └ main-planner.travelMinutes(...)
```

| 파일 | 역할 |
| --- | --- |
| `apps/api/src/planner/helpers/route.helper.ts` | 경로 조회·캐싱·폴백 전체 |
| `packages/types/src/trip.ts` | `RouteMode` 정본 타입 |
| `apps/api/src/planner/constraint/constraint.engine.ts` | 구간 이동시간 검증 (병렬) |

## 9. 환경변수

```bash
# 자동차 경로·ETA: 카카오 모빌리티 길찾기 (KAKAO_REST_API_KEY 공용)
KAKAO_REST_API_KEY=

# ODsay API (대중교통)
ODSAY_API_KEY=
# ODsay 는 키 발급 시 등록한 서비스 URL 을 Referer 로 검증한다.
# 등록한 값과 정확히 같아야 하며, 없으면 ApiKeyAuthFailed 로 폴백된다.
ODSAY_SERVICE_URL=http://localhost:4000
```

`TMAP_API_KEY` 는 제거됐다.

## 10. 검증

실제 키 + 실제 Redis 로 `RouteHelper` 를 그대로 태워 확인했다 (모킹 테스트는 실제 API 가 된다는 증거가 아니다).

```
— 시청→강남역 (수단별) —
  car      12.10km / 37분      (카카오 모빌리티, 실시간 교통 반영)
  transit  10.76km / 40분      (ODsay)
  walk      8.78km / 150분     (로컬 추정, 고치기 전엔 40분)

— 도보 300m —
  walk      0.30km / 5분       (10분 바닥 안 씌워짐)

— 캐싱 —
  car      cold 297ms → warm 2ms, 값 일치
  transit  cold 142ms → warm 0ms, 값 일치
  route:eta:car:...     TTL 3600s
  route:eta:transit:... TTL 43200s

— 동시 8건 (콜드) —
  261ms, 결과 1종 → API 1회로 병합
```

유닛 테스트: route.helper 26개 + constraint 4개, 전체 API 149개 통과.

기존 테스트가 `distanceM: 12 * 1000` 으로 **단위 버그를 정답으로 고정**해두고 있어 함께 고쳤다. `ioredis` 는 인메모리 스텁으로 목킹한다 — 실제 `ioredis` 를 쓰면 개발 머신의 Redis 가동 여부에 따라 앞 테스트가 캐싱한 값을 뒤 테스트가 읽어 flaky 해진다.

## 11. 알려진 제한 / 후속

- **`departAt` 미지원** — 모든 질의가 암묵적으로 "지금" 기준이다. 대중교통은 시간표 의존이라 심야 일정의 ETA 가 실제와 어긋날 수 있다. Live 폴링 소비자가 생기면 캐시가 얼어붙으므로, 그때 `departAt` 을 캐시 키에 넣어야 한다.
- **도보는 직선거리 추정** — 강·산·고가로 우회를 모른다. 1.3배 우회 계수는 평균치라 지형에 따라 어긋난다.
- **in-flight 병합은 프로세스 내에서만** — 스케일아웃하면 인스턴스 간 중복 호출은 캐시 TTL 로만 줄어든다. 필요해지면 Redis 락.
- **ODsay 쿼터** — 무료 플랜 한도를 넘기면 폴백으로 조용히 떨어진다. 폴백 발생을 지표로 노출할지 검토 필요.
- **라이브 배포 시 `ODSAY_SERVICE_URL`** 을 실제 등록 도메인으로 바꿔야 한다. localhost 로 두면 인증이 깨지는데 폴백이 삼켜서 에러 없이 추정치가 나간다 — 이번과 똑같은 방식으로 조용히 실패한다.
- **`packages/types/dist` 가 stale 하면 유령 tsc 에러가 난다.** dist 는 gitignore 라 브랜치를 갈아타도 안 바뀐다. 폐기한 OTP 브랜치에서 빌드된 dist 때문에 소스에 없는 필드가 required 로 잡혀 한 번 오진했다. 소스에 없는 필드를 tsc 가 요구하면 `npx turbo run build --filter=@tripick/types` 부터.
