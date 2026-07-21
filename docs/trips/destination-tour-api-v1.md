# 여행 지역 선택 · 관광공사 API 연동 v1

문서 목적: 신규 여행 생성(`/trips/new`)의 "여행 지역" 입력을 하드코딩 fixture에서 한국관광공사 국문관광정보 API 연동으로 교체하고, 지도에서 지역을 선택하는 기능을 추가한 작업을 고정한다.

기준 브랜치: `feat/destination-tour-api` (base: `develop`)
작성일: 2026-07-06
선행 문서: [`docs/trips/trip-create-v1.md`](./trip-create-v1.md) (`/trips/new` 폼 구조)
관련 컨텍스트: [`CLAUDE.md`](../../CLAUDE.md) §6 외부 API 연동

## 1. 범위

포함:
- 여행 지역 자동완성 백엔드를 관광공사 `areaCode2`(시도·시군구) 실데이터로 교체
- 빈 검색(입력 전) 시 인기 여행지 우선 노출
- 여행 지역 입력 옆 "지도에서 선택" 기능 (탭 지점 역지오코딩 → 행정구역 확정)
- 하드코딩 fallback fixture(`destinations.fallback.ts`) 제거

제외:
- 일정 생성 장소 카탈로그([`planner.service.ts`](../../apps/api/src/planner/planner.service.ts) `PLACE_SEEDS`) 연동 — 후속 (아래 §6)
- 영업시간 제약(`detailIntro2`)·재계획 대안 후보(`locationBasedList2`) 연동 — 후속
- 지역 목록 Redis 캐싱 (현재 프로세스 메모리 캐시)

## 2. 배경

기존 자동완성은 `DESTINATION_FALLBACKS` 정적 배열(22개, 서울·부산·제주 등)만 반환했다. 관광공사 국문관광정보 서비스(GW, data.go.kr 15101578)를 붙여 전국 행정구역을 실데이터로 제공한다. 기상청 단기예보([`weather.helper.ts`](../../apps/api/src/planner/helpers/weather.helper.ts))와 동일한 data.go.kr 패턴이라 axios + `ConfigService` 구조를 그대로 따른다.

## 3. 백엔드 — 지역 자동완성

### 3.1 DestinationsService

[`apps/api/src/main-planner/destinations.service.ts`](../../apps/api/src/main-planner/destinations.service.ts)

- 엔드포인트: `GET https://apis.data.go.kr/B551011/KorService2/areaCode2`
- 파라미터: `serviceKey`, `numOfRows=100`, `pageNo=1`, `MobileOS=ETC`, `MobileApp=TriPick`, `_type=json`, (선택) `areaCode`
- 동작:
  - `areaCode` 미지정 → 17개 시도 조회
  - 시도별 `areaCode` 지정 → 해당 시군구 조회
  - 평탄화하여 `name`=시군구명, `region`=상위 시도, 시도 자체도 후보로 포함
  - **총 251건** (17 시도 + 234 시군구)
- 캐싱: 최초 1회 조회 후 `private cache: Promise<...>` 에 보관 (프로세스 메모리). 실패 시 캐시 폐기 후 다음 요청에서 재시도.
- 이모지: API에 없어 시도명 기반 `SIDO_EMOJI` 맵으로 매핑 (미매칭 시 `📍`, 실데이터에선 17개 시도 전부 매핑됨)
- 인기 우선순위: 빈 검색 시 `POPULAR_NAMES`(제주·부산·강릉·경주·여수·전주·속초·서울) 순으로 상단 배치 후 8개 반환

### 3.2 응답 정규화 주의사항

data.go.kr 공통 특성으로 `response.body.items` 가 `''`(빈 문자열) · 단일 객체 · 배열 중 하나로 온다. `toItemArray`에서 세 경우를 모두 흡수한다. (기상청 PCP 문자열 파싱과 같은 계열의 방어 처리)

### 3.3 컨트롤러 배선

[`main-planner.controller.ts`](../../apps/api/src/main-planner/main-planner.controller.ts) `GET /main-planner/destinations` → `destinationsService.search(q)`. `DestinationsService`는 [`main-planner.module.ts`](../../apps/api/src/main-planner/main-planner.module.ts) provider로 등록. 프론트([`entities/trip-plan/api.ts`](../../apps/web/src/entities/trip-plan/api.ts) `fetchDestinationSuggestions`)와 `DestinationSuggestionDto` 형태는 그대로 유지되어 FE 무변경.

## 4. 프론트 — 지도에서 선택

### 4.1 DestinationMapPicker

[`apps/web/src/features/destination-search/ui/destination-map-picker.tsx`](../../apps/web/src/features/destination-search/ui/destination-map-picker.tsx)

- 여행 지역 입력 옆 "🗺️ 지도" 버튼 → `BottomSheet`([`shared/ui`](../../apps/web/src/shared/ui/bottom-sheet.tsx)) 안에 카카오 지도
- **지도 탭** → `kakao.maps.services.Geocoder.coord2RegionCode(lng, lat, cb)` 로 역지오코딩 → 행정동(`region_type: 'H'`) 우선으로 시도·시군구 추출 → `destination` 확정 (자동완성과 동일하게 시군구명 사용, 라벨은 "부산광역시 해운대구" 형태 표시)
- **장소 검색** → `kakao.maps.services.Places.keywordSearch` 로 첫 결과 위치로 지도 이동 + 마커/선택 갱신 (전국 지도에서 목표 지점으로 빠르게 이동)
- 확정 버튼은 위치 선택 전 비활성화. 지도 키 없으면 안내 폴백.

### 4.2 kakao-loader 타입 확장

[`apps/web/src/shared/lib/kakao-loader.ts`](../../apps/web/src/shared/lib/kakao-loader.ts)

- `event` 네임스페이스(`addListener`/`removeListener`, 지도 클릭)
- `services` 네임스페이스(`Geocoder.coord2RegionCode`, `Places.keywordSearch`, `Status`)
- `KakaoMarkerInstance.setPosition` (마커 이동)
- SDK는 이미 `libraries=services`로 로드 중이라 로더 변경 없이 타입만 추가

### 4.3 폼 배치

[`trip-create-view.tsx`](../../apps/web/src/views/trip-create/ui/trip-create-view.tsx) 여행 지역 `Field` 내부를 flex 행으로 바꿔 `DestinationSearchInput`(flex-1) + `DestinationMapPicker` 배치.

## 5. 설정 / 환경변수

- `apps/api/.env` : `KTO_API_KEY` (data.go.kr 국문관광정보 GW 서비스 인증키). data.go.kr 계정 공통 인증키로, 기상청 키와 동일 값 사용 가능.
- 키 미설정 시: 지역 목록 빈 배열(fallback 제거됨). 지도 선택은 `NEXT_PUBLIC_KAKAO_MAP_KEY` 필요.

## 6. 후속 작업 (관광공사 API 추가 적용 후보)

같은 국문관광정보 GW 서비스의 다른 오퍼레이션으로 확장 가능:

| 우선 | 적용처 | 오퍼레이션 | 효과 |
| ---- | ------ | ---------- | ---- |
| 1 | 일정 생성 카탈로그 `PLACE_SEEDS` | `areaBasedList2` | 전국 실제 관광지·식당·카페로 일정 생성 (현재 서울·부산·제주 외 전부 더미 default) |
| 2 | 영업시간 제약 `constraint.engine` | `detailIntro2` (usetime) | 하드코딩 영업시간 → 실데이터 검증 (usetime 자유텍스트 파싱 필요) |
| 3 | 재계획 대안 후보 AlternativeModule | `locationBasedList2` | 웨이팅·이탈 시 현재 좌표 주변 실제 관광지 제안 |

## 7. 검증

- API 실호출: `areaCode2` `resultCode 0000 OK`, 17 시도 / 부산 16 시군구 / 총 251건 확인
- 인기 우선순위: 빈 검색 → `제주·부산·강릉시·경주시·여수시·전주시·속초시·서울`
- 검색: `해운대`→해운대구(부산), `제주`→제주 시도+시군구
- 타입체크: `apps/api`·`apps/web` `tsc --noEmit` 통과
- `/trips/new` dev 컴파일 HTTP 200, 컴파일 에러 없음
- 참고: 이 저장소는 eslint flat config 미설정 + Next 16에서 `next lint` 제거로 lint 스킵

## 8. 변경 파일

```
apps/api/src/main-planner/destinations.fallback.ts   (삭제)
apps/api/src/main-planner/destinations.service.ts    (신규)
apps/api/src/main-planner/main-planner.controller.ts
apps/api/src/main-planner/main-planner.module.ts
apps/web/src/features/destination-search/index.ts
apps/web/src/features/destination-search/ui/destination-map-picker.tsx  (신규)
apps/web/src/shared/lib/index.ts
apps/web/src/shared/lib/kakao-loader.ts
apps/web/src/views/trip-create/ui/trip-create-view.tsx
```
