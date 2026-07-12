# 메인 여행 목록 개편(Main Page Filters·Card) v1

문서 목적: 메인 페이지(`/`, 내 여행 목록)를 "여행 카드를 나열"하던 화면에서 **상태를 정직하게 반영하고, 지금 중요한 여행을 앞세우며, 취향으로 다음 여행지를 제안**하는 화면으로 끌어올린 작업을 고정한다. 상태 라벨·필터 개편, draft(초안) 개념 정리(fail-hard), 카드 리디자인, 목록 UX(로딩·빈 상태·삭제), 히어로 카드, 검색·정렬, 취향 기반 추천 여행지(시/군/구 세분화)를 정리한다.

기준 브랜치: `feat/main-page-filters-card`
관련 문서: [`docs/main-planner-v1.md`](./main-planner-v1.md) (플래너 초기 화면·`TripSummaryDto`), [`docs/place-embedding-and-preference-personalization-v1.md`](./place-embedding-and-preference-personalization-v1.md) (취향·장소 임베딩), [`docs/rag-crag-v1.md`](./rag-crag-v1.md) (CRAG 검색), [`docs/destination-tour-api-v1.md`](./destination-tour-api-v1.md) (관광공사 지역 목록), [`docs/trip-progress-live-v1.md`](./trip-progress-live-v1.md) (진행 중 여행·`/trip/live`)

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

## 8. 추천 여행지 — 취향 개인화 (`widgets/destination-suggestions`, `main-planner`)

목록 하단에 "이런 여행지 어때요?" 섹션. 취향 벡터로 지역을 랭킹하고, 카드 원탭 시 `/trips/new?destination=` 프리필로 생성에 진입한다.

### 배경 — 이미 있는 인프라 재사용

- 취향 임베딩(`preference_embeddings`, `PreferencesService.getPreferenceVector`)과 장소 임베딩(`place_embeddings`)은 **같은 벡터 공간**이며, 취향↔장소 코사인은 이미 CRAG 리트리벌 리랭킹에 쓰인다. 즉 개인화 자체는 새 임베딩 작업이 아니라 **지역 단위 집계 쿼리**만 있으면 된다.

### 지역 랭킹 (`PlaceEmbeddingRepository.recommendRegions`)

- `(destination_region, region_sigungu)` 조합으로 그룹핑, 지역별 **상위 topK개 장소의 취향 코사인 평균**을 점수로 랭킹(window `ROW_NUMBER`). "내 취향 스팟이 많은 지역"이 상위로.
- 조합 키라 서로 다른 시도의 동명 시군구('대구 중구' vs '부산 중구')가 안 섞임. 벡터 차원 불일치 등 실패 시 `[]` 반환 → 인기순 폴백.

### 시/군/구 세분화 (`DestinationsService.recommend`)

- 후보를 넉넉히 받아 **시도별 대표 1개로 접되, 시군구 데이터가 있으면 그 시도의 최고 시/군/구로 대표**(경상북도→경주시, 대구광역시→달서구). 도 단위 중복(경상북도 + 경주시) 노출을 막고 구체적 시를 노출.
- 밀도가 큰 "시도 전체" 버킷이 개별 시군구를 가리지 않도록 `preferSigungu`(시군구 우선, 같은 급이면 고점수)로 대표 선택.
- 표기: 카드 제목=시군구(예: '경주시') 또는 시도, 부제=상위 시도로 '중구' 등 모호함 해소. 이모지는 원본 시도명으로 매칭('경상북도'→🏛️).
- 폴백: 취향 벡터 없음(온보딩 전)·시딩 부족이면 인기 여행지, 추천이 목표 수 미만이면 인기순으로 채움.

### 커버리지 한계(정직 고지)

- `region_sigungu` 는 현재 **경북·대구에만** 채워짐(전체 236/2135건). 시 단위가 폭넓게 뜨려면 인제스천 시 시군구 커버리지 확대가 필요 — 코드가 아니라 데이터 과제.
- 밀도가 큰 시도-전체 버킷이 점수상 유리한 경향은 있으나, 시도별 대표 접기로 시군구가 최소한 그 시도의 얼굴로는 항상 노출된다.

## 9. API / 타입

| 메서드 | 경로 | 인증 | 응답 |
| --- | --- | --- | --- |
| GET | `/main-planner/destinations/recommended` | 필요 | `DestinationSuggestionDto[]` (취향 랭킹, 폴백 인기순) |
| POST | `/main-planner/trips` (생성) | 필요 | 실패 시 **롤백 + 503**(`ServiceUnavailableException`) |

- `PlaceEmbeddingRepository` 를 `PlannerModule` 에서 **export** → `MainPlannerModule` 의 `DestinationsService` 가 주입.
- `RegionRecommendation`(`region`/`sigungu`/`score`/`places`) 타입 추가.
- 프론트: `fetchRecommendedDestinations`, `queryKeys.planner.recommendedDestinations`, `/trips/new` 서버 `searchParams` 로 `?destination=` 프리필(클라 `useSearchParams` 회피).
- 타입 변경 없음(`DestinationSuggestionDto` 재사용).

## 10. 검증

- web·api 타입체크 통과(`tsc --noEmit`), 웹 프로덕션 빌드 통과(`/trips/new` 가 `searchParams` 로 dynamic 전환 확인).
- API 부팅·DI 그래프 해소 확인, `GET /main-planner/destinations/recommended` 라우트 매핑 확인.
- 추천 SQL 을 실 DB(2135건/17지역)에서 실행 → 지역이 취향 점수순으로 정상 랭킹, 시도별 대표가 **경상북도→경산시 / 대구광역시→동구** 로 시 단위 접힘 확인.

## 11. 후속 작업

- 시군구 `region_sigungu` 인제스천 커버리지 확대(현재 경북·대구만) → 시 단위 추천 실효 확대
- 히어로 카드 날씨 미리보기(요약 API 기상청 연동)
- 기존 draft 잔해 일괄 정리 마이그레이션(선택)
- 추천 여행지 서버 캐시(현재 프론트 `staleTime` 30분만), 밀도 편향 보정 실험
