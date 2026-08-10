# 메인 여행 목록 개편(Main Page Filters·Card) v1

문서 목적: 메인 페이지(`/`, 내 여행 목록)를 "여행 카드를 나열"하던 화면에서 **상태를 정직하게 반영하고, 지금 중요한 여행을 앞세우며, 취향으로 다음 여행지를 제안**하는 화면으로 끌어올린 작업을 고정한다. 상태 라벨·필터 개편, draft(초안) 개념 정리(fail-hard), 카드 리디자인, 목록 UX(로딩·빈 상태·삭제), 히어로 카드, 검색·정렬, 취향 기반 추천 여행지(시/군/구 세분화)를 정리한다.

기준 브랜치: `feat/main-page-filters-card`
작성일: 2026-07-12
관련 문서: [`docs/planner/main-planner-v1.md`](../planner/main-planner-v1.md) (플래너 초기 화면·`TripSummaryDto`), [`docs/preference/place-embedding-and-preference-personalization-v1.md`](../preference/place-embedding-and-preference-personalization-v1.md) (취향·장소 임베딩), [`docs/planner/rag-crag-v1.md`](../planner/rag-crag-v1.md) (CRAG 검색), [`docs/trips/destination-tour-api-v1.md`](./destination-tour-api-v1.md) (관광공사 지역 목록), [`docs/trips/trip-progress-live-v1.md`](./trip-progress-live-v1.md) (진행 중 여행·`/trip/live`)

## 1. 범위

포함:

- **상태 라벨·필터 개편**: "곧 출발" → **"출발 전"**, "초안" → **"준비 중"**
- **draft 개념 정리**: 일정 생성 실패 시 draft 좀비 여행을 남기던 동작을 **fail-hard 롤백**으로 변경, "준비 중" 필터 제거
- **카드 리디자인**: 정중앙 이모지 배너 → 좌상단 **앱 아이콘 배지**
- **목록 UX**: 초기 로딩 스켈레톤, 빈 상태 문구 분기, 클릭 불가 draft 카드에 삭제 경로
- **히어로 카드**: 진행 중/출발 임박 여행을 상단에 D-day·라이브 바로가기로 스포트라이트
- **검색·정렬**: 제목·목적지 검색 + 최신순·출발임박순 정렬
- **추천 여행지**: 취향 벡터 기반 지역 추천(시/군/구 세분화) + 인기순 폴백, 원탭 생성 프리필
- 웹(Next.js) UI + `main-planner`/`trips` 백엔드 + 공통 타입

제외:

- 진짜 취향 개인화의 **커버리지 확대**(시군구 `region_sigungu` 인제스천은 현재 경북·대구만) — 데이터 과제
- 히어로 카드 **날씨 미리보기**(요약 API에 기상청 연동 필요, 후속)
- 기존 DB에 남은 draft 여행 **일괄 정리 마이그레이션**(UI 삭제로 대체)

## 2. 상태 라벨·필터 개편

- 요약 상태(`TripSummaryStatus` = `draft | upcoming | ongoing | done`)는 서버가 KST 기준으로 파생(`summaryStatus`), 라벨은 `summaryStatusLabel`.
- 라벨 변경: `upcoming` **"곧 출발" → "출발 전"**, `draft` **"초안" → "준비 중"**. 프론트 필터 칩·요약 타일·카드 Chip 라벨을 모두 일치시킴.
- 요약 타일은 draft 제거 후 **진행 중(ongoing)**으로 대체(발생하는 상태만 노출).

## 3. draft 개념 정리 — fail-hard 롤백

- 문제: 여행은 생성 시 항상 `confirmed`로 시작하고, 일정 생성이 실패해야만 `draft`로 남았다. **재생성(regenerate) 수단이 없어** draft 여행은 되살릴 수 없는 좀비였고, 클릭 불가(`hasDetail:false`)라 삭제 경로조차 없었다.
- 변경(`trips.service.ts`): 생성 실패 시 방금 만든 trip 을 `repo.delete()` 로 **롤백**하고 `ServiceUnavailableException` 을 던진다. 좀비 draft 를 남기지 않고 사용자가 생성을 다시 시도하게 한다.
  - 일정 항목·멤버는 FK `onDelete: CASCADE` 라 롤백 안전. 멤버는 생성 성공 후 붙으므로 실패 경로엔 없음.
- 프론트에서 "준비 중"(draft) 필터 버튼 제거. draft 는 이제 정상 흐름에서 발생하지 않음.
- **기존 잔해**: 이번 변경 전 DB 에 쌓인 draft 여행은 전체 필터엔 보이되, 카드 삭제 경로(§4)로 사용자가 직접 정리한다.

## 4. 목록 UX (`views/trips`, `entities/trip-plan`)

- **로딩 스켈레톤**: `useQuery` 의 `isLoading` 사용. 초기 로드(캐시 없음)에 EmptyState 가 깜빡이던 문제 → 스켈레톤 카드 3개 표시.
- **빈 상태 분기**(`EmptyState.hasTrips`): 여행 0개(신규) → "아직 만든 여행이 없어요 / 첫 여행을 만들어 일정을 받아보세요" + 생성 버튼. 필터·검색 결과만 0개 → "해당 조건의 여행이 없어요 / 다른 필터를 선택해보세요"(버튼 숨김).
- **draft 카드 삭제 경로**: `TripSummaryCard` 에 `draftAction` **슬롯**을 추가. 상세 진입 불가(`hasDetail:false`) 카드의 "상세 준비 중" 행에 노출. 삭제 뮤테이션은 feature 소관이라 **엔티티는 슬롯만 열고 view 에서 `DeleteTripButton` 을 주입**(FSD 정방향 유지).

## 5. 카드 리디자인 (`TripSummaryCard`)

- 128px 정중앙 이모지 배너 → **64px 짧은 그라데이션 밴드 + 좌상단 흰색 라운드 사각 아이콘 타일(44px)** 로 앱 아이콘처럼. 상태 Chip 은 밴드 우측 오버레이. 목적지·제목 가독성이 올라가고 카드 세로 공간이 줄었다.

## 6. 히어로 카드 (`views/trips`)

- 목록 최상단에 가장 중요한 여행 1건을 스포트라이트. **진행 중 우선, 없으면 출발이 가장 임박한 여행**(둘 다 `hasDetail` 있는 것만 선정해 링크가 항상 유효).
- 진행 중 → "여행 중 · N일차" + 라이브 도트 + `/trip/live`. 출발 전 → "D-{n}"/"D-DAY" + `/planner?tripId=`.
- D-day 는 KST 기준 클라 계산(`kstToday`/`diffDays`, `Date.parse('...T00:00:00Z')` 로 인덱스 접근 회피).
- 진행 중 여행 진입은 전역 `ActiveTripFab` 과 중복되지만, 히어로는 목록 화면 스포트라이트로 역할이 다름.

## 7. 검색·정렬 (`views/trips`)

- 제목·목적지 부분일치 검색 + 정렬(최신순=서버 `createdAt DESC` 유지 / 출발임박순=`startDate` 오름차순). 상태 필터와 조합해 `visible` 로 합성.
- 여행이 1건 이상일 때만 검색·정렬 바 노출.

## 8. 추천 여행지 — 이번 달 네이버 추천 + 취향 개인화 (`widgets/destination-suggestions`, `main-planner`)

목록 하단 "이런 여행지 어때요?" 섹션. 네이버 검색으로 **이번 달 "국내 여행지 추천" 코퍼스**를 모아 그 안에 실제 언급된 여행지만 후보로 추린 뒤(파서), **사용자 취향으로 랭킹**한다. 카드 원탭 시 `/trips/new?destination=` 프리필로 생성에 진입한다.

### 왜 계절 검색인가

- 취향 벡터만으로 지역을 랭킹하면(구버전) 시딩 커버리지·밀도 편향에 좌우되고 "지금 갈 만한 곳"이라는 **시의성**이 빠진다. 네이버 추천 글의 언급을 후보 풀로 쓰면 시기성(7월=여름 여행지)이 자연히 반영된다.
- 이미 있는 `NaverSearchService`(인지도 재랭킹용 블로그·카페 코퍼스)를 재사용 — 새 외부 연동 없음.

### 계절 코퍼스 (`NaverSearchService.getSeasonalDestinationIndex`)

- 현재 연·월로 `"2026년 7월 국내 여행지 추천"`·`"7월 여행지 추천"`·`"7월 국내여행 가볼만한 곳"` 3개 검색어를 블로그+카페로 조회해 title+description 코퍼스화. **월 단위 캐시**(같은 달 추천 글은 느리게 변함).
- `collectCorpus`·`buildIndex` 를 검색어 배열로 일반화해 인지도 인덱스와 배관 공유. 키 없음·코퍼스 빔 시 비활성 인덱스(`docCount=0`) 반환.

### 파서 — 역방향 매칭 (`DestinationsService.parseSeasonalCandidates`)

- KTO 시도·시군구 목록 중 **계절 코퍼스에 언급된 것만** 후보로 남긴다. 블로그가 '경주시'가 아닌 '경주'로 쓰므로 행정 접미사를 뗀 어간(`regionSearchStem`)으로 카운트 — 기존 인지도 신호와 동일한 **역방향 매칭**(불안정한 한글 NER 회피).
- 같은 어간이 여러 행정단위에 겹치면(시도 '부산' vs 시군구 '부산진구') 언급 많은 쪽만 대표. 표시 이름도 어간('강릉')으로 정리해 카드 제목·여행 생성 질의에 그대로 사용.

### 취향 랭킹 (`recommendSeasonal` + `preferenceScoreMap`)

- 후보를 **취향 점수 0.7 + 계절 언급 점수 0.3** 로 결합해 정렬. 취향 점수는 기존 `recommendRegions`(지역별 상위 topK 장소 취향 코사인 평균, `(destination_region, region_sigungu)` 그룹핑·window `ROW_NUMBER`)를 어간 키 맵으로 만들어 대조.
- 취향 벡터 없으면(온보딩 전) 계절 언급 순으로만 랭킹. 후보가 목표(8개) 미만이면 인기 여행지로 채움.

### 폴백 — 취향/인기 (`recommendByPreference`)

- 네이버 키 없음·코퍼스 빔이면 구버전 경로로 회귀: `recommendRegions` 취향 랭킹 → **시도별 대표 접기**(`preferSigungu`: 시군구 우선, 같은 급이면 고점수, 예 경상북도→경주시) → 인기순 폴백. 지역 랭킹·시군구 세분화 로직은 이 경로에 그대로 보존.

### 지역 라벨 정정 (`SIDO_DISPLAY`)

- 부제(시도명)를 접미사 제거로 만들던 걸 **정식명 → 정규 약칭 매핑**으로 교체. '충청북도'→'충북', '경상남도'→'경남' 등 2글자 약칭 정상화.
- KTO `ldongCode2` 코드 `12` 는 원본이 `전남광주통합특별시`(광주+전남 병합)로 깨져 와, 접미사만 떼면 '전남광주통합'이 남던 것 → '전남'으로 명시 매핑(하위 시군구가 여수·순천·담양 등 전남 시군 대다수).

### 커버리지 한계(정직 고지)

- 취향 점수는 여전히 시딩된 지역(`seoul`/`busan`/`jeju`/`gyeongju`)에만 붙어, 그 외 계절 후보는 중립값(0.5)으로 언급 순만 반영된다. 취향 개인화 실효 확대는 `place_embeddings` 시군구 커버리지 확대(코드가 아니라 데이터 과제)에 달림.
- 계절 후보가 부족한 달·비수기엔 인기 여행지 채움 비중이 늘어난다.

## 9. API / 타입

| 메서드 | 경로 | 인증 | 응답 |
| --- | --- | --- | --- |
| GET | `/main-planner/destinations/recommended` | 필요 | `DestinationSuggestionDto[]` (이번 달 네이버 추천 후보 × 취향 랭킹, 폴백 취향/인기순) |
| POST | `/main-planner/trips` (생성) | 필요 | 실패 시 **롤백 + 503**(`ServiceUnavailableException`) |

- `PlaceEmbeddingRepository`·`NaverSearchService` 를 `PlannerModule` 에서 **export** → `MainPlannerModule` 의 `DestinationsService` 가 주입.
- `RegionRecommendation`(`region`/`sigungu`/`score`/`places`) 타입 추가.
- 프론트: `fetchRecommendedDestinations`, `queryKeys.planner.recommendedDestinations`, `/trips/new` 서버 `searchParams` 로 `?destination=` 프리필(클라 `useSearchParams` 회피).
- 타입 변경 없음(`DestinationSuggestionDto` 재사용).

## 10. 검증

- web·api 타입체크 통과(`tsc --noEmit`), 웹 프로덕션 빌드 통과(`/trips/new` 가 `searchParams` 로 dynamic 전환 확인).
- API 부팅·DI 그래프 해소 확인, `GET /main-planner/destinations/recommended` 라우트 매핑 확인.
- 추천 SQL 을 실 DB(2135건/17지역)에서 실행 → 지역이 취향 점수순으로 정상 랭킹, 시도별 대표가 **경상북도→경산시 / 대구광역시→동구** 로 시 단위 접힘 확인(폴백 경로).
- 계절 전환 후: `destinations.service`·`naver-search.service` 타입체크·ESLint 통과. KTO `ldongCode2` 시도 목록을 실 API로 조회해 코드 `12`가 `전남광주통합특별시`로 깨져 오는 것 확인 → `SIDO_DISPLAY` 매핑 근거.

## 11. 후속 작업

- 시군구 `region_sigungu` 인제스천 커버리지 확대(현재 경북·대구만) → 계절 후보의 취향 점수 실효 확대(현재 시딩 지역 외엔 중립값)
- 계절 검색어·가중(0.7/0.3) 튜닝, 계절 코퍼스 결과의 LLM 하네스 회귀 편입
- 히어로 카드 날씨 미리보기(요약 API 기상청 연동)
- 기존 draft 잔해 일괄 정리 마이그레이션(선택)
- 추천 여행지 서버 캐시(현재 프론트 `staleTime` 30분 + 네이버 월 단위 캐시), 밀도 편향 보정 실험
