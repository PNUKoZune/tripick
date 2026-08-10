# 기상청 단기예보 web 실연동 v1

문서 목적: main-planner 정보 탭의 mock 날씨를 기상청 단기예보 실데이터로 교체하고, 반복 호출을 줄이는 Redis 캐시를 적용한 작업을 고정한다.

기준 브랜치: `feat/weather-forecast-web-integration`
작성일: 2026-07-01
관련 문서: [`docs/planner/main-planner-v1.md`](../planner/main-planner-v1.md) (Screen 3 정보 탭, 그동안 mock 날씨), [`CLAUDE.md`](../../CLAUDE.md) 6절 (기상청 API 주의사항)

## 1. 범위

포함:

- main-planner 정보 탭(`trip-info-panel`) 날씨를 기상청 단기예보 실데이터로 교체
- 여행 일자별 하늘/강수 상태 emoji + 최저/최고 기온 라벨 생성
- 예보 범위(~3일) 밖/키 미설정/API 장애 시 "확인 전" 폴백 유지
- `PlannerWeatherDto.forecasted` 플래그 + web "확인 전" 안내 툴팁
- `WeatherHelper` Redis 캐시 (발표 주기 단위)

제외:

- 정식 planner 파이프라인/일정 생성 로직 변경 (LLM·RAG 무관)
- React Native 적용
- 강수확률·습도 등 상세 지표 노출 (내부 판정에만 사용)

## 2. 데이터 흐름

```
[web] GET /api/v1/main-planner/trips/:tripId
  → MainPlannerService.getTrip
  → toPlannerTrip → buildWeather(center, days)
      → WeatherHelper.getForecast(lat, lng)         # 지도 center 좌표
          ├ Redis 캐시 hit → 예보맵 반환
          └ miss → 기상청 단기예보 호출 → 캐시 저장
      → 일자(fcstDate)별 필터 → PlannerWeatherDto[] 매핑
  → meta.weather 로 응답
[web] trip-info-panel: forecasted=false 행에만 안내 툴팁
```

## 3. 붙인 지점

main-planner 는 정식 planner 와 분리된 mock 성격의 데모 모듈이지만 web Screen 3 이 실제로 소비하는 지점이라, 여기에 `WeatherHelper` 를 재사용해 연결했다. 정식 planner 파이프라인은 건드리지 않는다.

| 레이어 | 파일 | 변경 |
| ------ | ---- | ---- |
| types | [`packages/types/src/main-planner.ts`](../../packages/types/src/main-planner.ts) | `PlannerWeatherDto.forecasted: boolean` 추가 |
| api (module) | [`apps/api/src/main-planner/main-planner.module.ts`](../../apps/api/src/main-planner/main-planner.module.ts) | `WeatherHelper` provider 등록 |
| api (service) | [`apps/api/src/main-planner/main-planner.service.ts`](../../apps/api/src/main-planner/main-planner.service.ts) | `buildWeather` / `describeWeather` 추가, mock 제거, `toPlannerTrip` async 화 |
| api (helper) | [`apps/api/src/planner/helpers/weather.helper.ts`](../../apps/api/src/planner/helpers/weather.helper.ts) | Redis 캐시 read/write, 연결 관리 |
| web | [`apps/web/src/widgets/trip-info-panel/ui/trip-info-panel.tsx`](../../apps/web/src/widgets/trip-info-panel/ui/trip-info-panel.tsx) | `forecasted=false` 안내 툴팁(react-icons `FiInfo`) |

## 4. 날씨 매핑 규칙

- 좌표: 여행 지도 `center` 좌표 1개로 예보를 1회 조회 (`latLngToGrid` 로 nx·ny 격자 변환)
- 일자 매칭: 예보의 `fcstDate`(YYYYMMDD) 와 각 일자 iso 를 맞춰 필터
- 기온: 해당 일자 슬롯의 최저/최고 → `24° / 32°` 형태
- 상태 판정: 낮 대표 슬롯(15시 → 없으면 12시 → 없으면 첫 슬롯)
  - PTY(강수형태) 우선: 1 비 🌧️ / 2 비·눈 🌨️ / 3 눈 ❄️ / 4 소나기 🌦️
  - PTY 0 이면 SKY(하늘): 1 맑음 ☀️ / 3 구름많음 ⛅ / 4 흐림 ☁️
- 폴백: 예보 없음/키 없음/장애 시 `forecasted:false`, `☁️ … 날씨 확인 전`, `-`

## 5. Redis 캐시

- 키: `weather:forecast:{nx}:{ny}:{baseDate}:{baseTime}`
- TTL: 3시간 (단기예보 발표 주기와 정렬 — 같은 발표시간대엔 값 유지, 새 발표는 새 키)
- 직렬화: `Map<string, ParsedForecast>` ↔ `JSON([...map])`
- 장애 격리: `lazyConnect` + `enableOfflineQueue:false` + error 핸들러, read/write 전부 try/catch → Redis 다운돼도 예보 조회 자체는 실패하지 않음
- 빈 결과(size 0)는 캐싱하지 않음
- 기존 인라인 ioredis 패턴(app.module throttler/BullMQ)과 동일하게 `REDIS_HOST`/`REDIS_PORT` 사용
- `planner` 모듈도 같은 `WeatherHelper` 를 쓰므로 캐시 혜택을 공유

## 6. 검증

```bash
pnpm --filter @tripick/types build
pnpm --filter @tripick/api typecheck
pnpm --filter @tripick/web typecheck
```

세 명령 모두 통과 (2026-07-01 기준).

수동/스모크 검증:

1. 기상청 API 실호출 확인 — 서울/경주 좌표, `WeatherHelper` 와 동일 방식(axios params) 으로 200 + 예보 파싱 성공
2. 키 형태 확인 — data.go.kr Decoding 키(원본 base64) 이므로 axios 자동 인코딩 방식이 정답, 별도 인코딩 처리 불필요
3. 매핑 스모크 — 경주 좌표 + 당일 예보로 일자별 emoji·상태·기온범위 정상 산출
4. Redis 라운드트립 — Map 직렬화 저장/복원 + TTL 확인

## 7. 알려진 제한 / 후속

- 여행 날짜가 오늘로부터 ~3일 밖이면 예보가 없어 해당 일자는 "확인 전" 폴백 (툴팁으로 안내)
- 좌표는 여행 center 1개 기준 — 일자별 지역 이동이 큰 여행은 지역별 정밀도 한계
- `base_time` 은 조회 시점 기준(발표 후 10분 지연 여유). 발표 직후 요청은 이전 발표를 사용할 수 있음
- 강수확률(POP)은 날씨 카드에 일자별 최대값을 노출한다. 습도는 불필요 판단으로 제외(판정용으로만 사용)
