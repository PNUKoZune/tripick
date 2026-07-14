# 기상청 중기예보 확장 + 날씨 버그 수정 v1

문서 목적: 단기예보(~3일)만 붙어 있던 날씨 조회를 중기예보(+3~+10일)까지 확장해 예보 커버리지를 최대 10일로 넓히고, 그 과정에서 발견한 날씨 서브시스템의 발표시각·타임존 버그와 견고성 이슈를 함께 고친 작업을 고정한다.

기준 브랜치: `feat/mid-term-forecast`
관련 문서: [`docs/weather-forecast-v1.md`](./weather-forecast-v1.md) (단기예보 web 실연동), [`CLAUDE.md`](../CLAUDE.md) 6절 (기상청 API 주의사항)

## 1. 범위

포함:

- 기상청 **중기예보 조회서비스**(중기육상예보 `getMidLandFcst` + 중기기온 `getMidTa`) 연동
- 단기(~3일) + 중기(+3~+10일) 병합 → 예보 커버리지 최대 **10일**
- 위경도 → 중기예보 지역코드(`regId`) 매핑 유틸 (단기 nx·ny 격자의 중기 대응)
- 소비 측(main-planner 정보 탭 주간 날씨, planner 강수 힌트)을 병합 예보로 전환
- 날씨 버그 3건 + 견고성 3건 수정 (아래 5절)

제외:

- 사용자가 링크한 **중기전망조회(`getMidFcst`)** — 응답이 산문 텍스트(`wfSv`)라 일자별 구조화 파이프라인에 부적합. 커버리지 목적은 육상예보+기온으로 동일 달성.
- 날씨 변화 감지 → 재계획 자동 트리거(스케줄러). 별도 feat 브랜치로 분리 (7절).
- React Native 적용, 강수확률·습도 등 상세 지표 UI 노출

## 2. 왜 중기전망이 아니라 육상예보+기온인가

같은 중기예보 조회서비스(data.go.kr 15059468) 안에 오퍼레이션이 여러 개다.

| 오퍼레이션 | 응답 | 대상 | 채택 |
| --- | --- | --- | --- |
| 중기전망조회 `getMidFcst` | 산문 텍스트(`wfSv`) 한 덩어리 | 지역 개황 | ✗ 일자별 구조화 불가 |
| 중기육상예보 `getMidLandFcst` | 일자별 강수확률(`rnStXAm/Pm`) + 날씨(`wfXAm/Pm`) | +3~+10일 | ✓ |
| 중기기온 `getMidTa` | 일자별 최저/최고(`taMinX`/`taMaxX`) | +3~+10일 | ✓ |

기존 파이프라인은 일자별 기온·강수확률 구조화 데이터(`ParsedForecast`)로 실내/외 배치를 판정하므로, 산문 전망은 그대로 못 꽂는다. 육상예보+기온을 기존 `ParsedForecast` 시간슬롯 형태로 **합성**해 소비 측이 단기·중기를 구분 없이 다루게 했다.

## 3. 데이터 흐름

```
getExtendedForecast(lat, lng)
  ├ getForecast(lat, lng)           # 단기예보 (~3일), nx·ny 격자
  │     └ Redis 캐시(3h) ↔ getVilageFcst
  └ getMidForecast(lat, lng)        # 중기예보 (+3~+10일), regId
        ├ latLngToMidRegion         # 위경도 → 가장 가까운 예보구역(육상/기온 regId)
        ├ getMidTmFc(now)           # 발표시각 tmFc (매일 06·18시, KST)
        ├ Promise.all[ getMidLandFcst, getMidTa ]   # Redis 캐시(12h)
        └ parseMidTermForecast      # 육상+기온 → 일자별 ParsedForecast 슬롯
  → 병합: 단기 존재 날짜 우선, 나머지는 중기로 채움
```

병합 규칙: 단기예보가 있는 날짜는 더 정밀하므로 우선하고 그 날짜의 중기 슬롯은 버린다. 나머지 날짜만 중기로 채운다.

## 4. 중기예보 합성 규칙

- **지역코드**: 중기예보는 격자가 아닌 `regId`. 위경도를 전국 17개 대표도시 중심점으로 nearest-centroid 스냅해 육상(`landRegId`, 도 단위 10구역) + 기온(`taRegId`, 대표도시) 코드를 얻는다.
- **일자 매핑**: `tmFc` 발표일 + N일 (N = 3~10). UTC 정수 연산으로 계산해 서버 TZ와 무관.
- **슬롯 전개**:
  - 3~7일: 오전(09시, 기온=최저) / 오후(15시, 기온=최고) 2슬롯, 각각 `rnStXAm/Pm` + `wfXAm/Pm`
  - 8~10일: 12시 단일 슬롯 (`rnStX` + `wfX`)
- **`wf` 텍스트 → SKY/PTY 정규화**: "맑음/구름많음/흐림" → SKY(1/3/4), "비/눈/소나기/비·눈" → PTY(1/3/4/2). 단기예보와 동일 코드로 통일해 `describeWeather`·`buildWeatherHint` 재사용.
- **폴백**: `KMA_API_KEY` 미설정·regId 조회 실패 시 빈 맵 → 기존 "확인 전"/"날씨 양호" 폴백 유지 (앱 안 깨짐).

## 5. 같이 고친 버그 / 견고성

검토에서 나온 날씨 서브시스템 전반 이슈.

### 버그

| # | 증상 | 원인 | 수정 |
| --- | --- | --- | --- |
| 1 | 새벽 00:00~02:10 단기예보 전부 빈 응답 | `getBaseTime` 이 발표시각만 계산 → 아직 없는 당일 0200 조회(NO_DATA) | 발표일까지 함께 내는 `getBaseDateTime` 으로 대체, 전날 2300 롤오버 |
| 2 | 서버 TZ 가 KST 아니면(prod 컨테이너 UTC) base_time 9시간 어긋남 | `toKmaDate`/`getBaseTime`/`getMidTmFc` 로컬 타임 기반 | `getKstParts` 로 Asia/Seoul 기준 통일, 중기 날짜는 UTC 정수 연산으로 분리 |
| 3 | 오늘이 아닌 여행은 단기예보 항상 빈 맵 | planner.service 가 `trip.startDate` 를 발표 기준일로 넘김 → 미래 base_date | `getExtendedForecast` 가 발표 기준을 항상 현재로 고정(대상일 필터는 소비 측 `fcstDate`) |

### 견고성

- **5** `parsePrecipitation` 이 `"30.0~50.0mm"`(범위)·`"50.0mm 이상"`·`"1.0mm 미만"` 을 못 잡던 것 보정 (범위→하한값, 미만→0.5 추정).
- **6** `getMidForecast` 부분 실패(육상·기온 중 한쪽만)는 30분만 캐시 → 일시 오류가 반나절 고착되지 않게.
- **7** `WeatherHelper` 를 `PlannerModule` 에서 export 해 단일 인스턴스 공유 → main-planner 중복 provider 제거(Redis 커넥션 1개).

## 6. 붙인 지점

| 레이어 | 파일 | 변경 |
| --- | --- | --- |
| utils | [`packages/utils/src/mid-region.ts`](../packages/utils/src/mid-region.ts) | (신규) 전국 대표도시 육상/기온 `regId` + `latLngToMidRegion` |
| utils | [`packages/utils/src/mid-forecast-parser.ts`](../packages/utils/src/mid-forecast-parser.ts) | (신규) 육상+기온 → `ParsedForecast` 합성, `wf`→SKY/PTY, `getMidTmFc`/`tmFcToDate` |
| utils | [`packages/utils/src/date.ts`](../packages/utils/src/date.ts) | `getKstParts`·`getBaseDateTime` 추가, `toKmaDate` KST 화 |
| utils | [`packages/utils/src/weather-parser.ts`](../packages/utils/src/weather-parser.ts) | `getBaseTime` 제거(→date.ts), `parsePrecipitation` 범위/미만 보정 |
| api (helper) | [`apps/api/src/planner/helpers/weather.helper.ts`](../apps/api/src/planner/helpers/weather.helper.ts) | `getMidForecast`(12h 캐시, 부분실패 30분) + `getExtendedForecast`(병합) |
| api (service) | [`apps/api/src/planner/planner.service.ts`](../apps/api/src/planner/planner.service.ts) | 강수 힌트 조회를 `getExtendedForecast` 로, 미래 base_date 인자 제거 |
| api (service) | [`apps/api/src/main-planner/main-planner.service.ts`](../apps/api/src/main-planner/main-planner.service.ts) | 주간 날씨 조회를 `getExtendedForecast` 로 (커버리지 ~10일) |
| api (module) | [`apps/api/src/planner/planner.module.ts`](../apps/api/src/planner/planner.module.ts) | `WeatherHelper` export |
| api (module) | [`apps/api/src/main-planner/main-planner.module.ts`](../apps/api/src/main-planner/main-planner.module.ts) | 중복 `WeatherHelper` provider 제거, PlannerModule 공유 |

## 7. 검증

```bash
pnpm --filter @tripick/utils build
pnpm --filter @tripick/utils test      # 54 passed
pnpm --filter @tripick/api exec tsc --noEmit -p tsconfig.json
pnpm --filter @tripick/api test        # 127 passed
pnpm --filter @tripick/api build       # nest build
```

전부 통과 (2026-07-14 기준).

**타임존 회귀**: utils 테스트를 `TZ=UTC` / `America/New_York` / `Pacific/Kiritimati`(UTC+14) / `Asia/Seoul` 로 각각 실행해 동일 통과 확인. 테스트 입력은 로컬 `new Date(y,m,d,h)` 대신 명시적 KST/UTC 인스턴트(`+09:00`/`Z`)로 재작성해 러너 TZ 무관하게 만듦.

## 8. 배포 전 운영 작업 (필수)

중기예보는 단기예보와 같은 provider(1360000)라 기존 `KMA_API_KEY` 를 그대로 쓰지만, data.go.kr 는 **서비스별 활용신청**이라 [중기예보 조회서비스(15059468)](https://www.data.go.kr/data/15059468/openapi.do) 에 활용신청을 추가해야 실제 응답이 온다. 신청 전에는 중기예보만 빈 맵으로 폴백되고 단기 3일은 정상 동작한다.

## 9. 알려진 제한 / 후속

- 중기예보 `regId` 는 대표도시 nearest-centroid 스냅이라 도 단위 해상도 — 국내 여행엔 충분하나 세밀한 지역차는 한계.
- 중기예보는 강수확률·최저/최고기온만 제공(강수량·습도·풍속 없음). 8~10일차는 오전/오후 구분 없이 하루 단위.
- **날씨 변화 감지 → 재계획 자동 트리거 부재** — 반응 로직(카테고리 분기·프롬프트 힌트·CRAG)은 있으나 `trigger:'weather'` 잡을 넣는 스케줄러가 없다([`alternative.processor.ts`](../apps/api/src/alternative/alternative.processor.ts) backlog 주석). 이번 확장으로 최대 10일 비교 기반이 생겼으니 별도 feat 브랜치로 붙이는 것을 권장.
