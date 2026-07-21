# 대안 장소 선택(Alternative Popup) v1

문서 목적: 일정 카드에서 여는 "실시간 대안" 팝업을 mock 데모에서 실제 사용 가능한 기능으로 끌어올린 작업을 고정한다. 진입점(전환 아이콘), 취향 기반 실데이터 추천, 항목 스코프 조건 재검색, 장소 이름 검색·확인, 제약 재검증이 붙은 swap, 되돌리기, 라이브 화면 연동, 바텀시트 UX까지를 정리한다.

기준 브랜치: `feat/alternative-place-picker`
작성일: 2026-07-10
관련 문서: [`docs/planner/main-planner-v1.md`](./main-planner-v1.md) (Screen 4 대안 팝업 초기 mock), [`docs/planner/rag-crag-v1.md`](./rag-crag-v1.md) (CRAG 검색 파이프라인), [`docs/trips/trip-progress-live-v1.md`](../trips/trip-progress-live-v1.md) (Live 화면·재계획 수신), [`docs/preference/place-embedding-and-preference-personalization-v1.md`](../preference/place-embedding-and-preference-personalization-v1.md) (취향 벡터 개인화)

## 1. 범위

포함:

- **진입 방식 변경**: 카드 클릭/더블클릭 → **전환(변경) 아이콘 버튼**으로 팝업 오픈. 카드 탭은 지도 초점만
- **기본 대안 추천**: mock → **CRAG/임베딩 실데이터**(취향 벡터 개인화), 같은 카테고리 우선 3~5개, 여행 전체 일정과 중복 제거
- **항목 스코프 조건 재검색**: 자유 텍스트("조용한 감성 카페 위주로")를 이 항목의 CRAG 검색 조건으로 반영 (동기, 비파괴적)
- **장소 이름 검색 → 확인**: 카카오 Local로 상위 3곳 검색 → 지도에서 확인 → 그 장소로 교체 (지도 링크 붙여넣기도 허용)
- **swap 재검증**: 좌표 기반 교체 + 앞/뒤 항목 **이동시간 재계산**(RouteHelper) + 실현가능성 경고 + 카테고리 반영 + **되돌리기**
- **Live(`/trip/live`) 연동**: 현재 일정의 "웨이팅 신고" 버튼을 대안 팝업 "일정 변경"으로 교체
- **바텀시트 UX**: 공통 X 닫기 버튼, 등장 애니메이션 완화
- **재계획 중복 제출 방지**(enqueue jobId dedup)
- 웹(Next.js) 전용, 대안 팝업 관련 백엔드(`main-planner`) + 공통 인프라

제외:

- 일자/전체 재계획 진입점 (트립 레벨 "AI로 일정 다시 짜기"는 후속. whole-trip replan plumbing은 보존)
- 영업시간 제약 검증 (카카오 후보에 영업시간 데이터 없음 → KTO 연동 시 확장)
- 현재 장소 vs 대안 비교 카드(P3-9)
- 대안 후보의 실제 평점/리뷰 수 (카카오 미제공)

## 2. 데이터 흐름

```
[일정 카드] 변경 아이콘(ChangeScheduleButton) 클릭
  → AlternativeSheet(open, item)
     └ useAlternativeController(tripId, itemId)
        ├ GET  …/items/:itemId/alternatives?note=        기본/조건 추천 (CRAG)
        ├ POST …/items/:itemId/resolve-place  {query}    장소 이름 → 실장소 상위 3
        └ POST …/trips/:tripId/swap  {itemId, place}     교체 + 이동시간 재계산 + 경고

[백엔드 MainPlannerService]
  getAlternatives → buildRecommendedAlternatives
     → PlaceRetrievalService.retrieve({ destination, currentLocation=item좌표,
         tasteTags, preferenceVector, notes=trip.notes·note })   # CRAG + 취향 개인화
     → 여행 전체 일정 이름과 중복 제거 → 같은 카테고리 우선 3~5개
     → (결과 없고 note 없음) mock 폴백으로 최소 3개
  resolvePlace → KakaoLocalService.searchByText(상위 3)
  swap → 좌표/이름/주소/카테고리 반영 → RouteHelper 로 prev/next 이동시간 재계산
       → 시간 간격 < (체류+이동)이면 warnings, previousPlace(되돌리기용) 반환
```

## 3. 진입점 — 전환 아이콘

- `shared/ui/change-schedule-button.tsx` — 원형 스왑(↔) 아이콘, hover/focus 시 "일정 변경" 툴팁. 웨이팅이면 빨강 톤. (절대배치는 호출부 래퍼가 담당, 컴포넌트 루트는 `relative` 툴팁 앵커)
- 카드 본문 탭 = 지도 초점, 아이콘 버튼 = 시트 오픈으로 역할 분리:
  - `entities/itinerary-item/ui/itinerary-item-card.tsx` (`onClick`=초점, `onSwitch`=시트)
  - `widgets/planner-timeline` (`onSelectItem` / `onSwitchItem`)
  - `widgets/trip-map-panel` (더블탭 제거 → 아이콘 버튼)
  - `views/planner` — 마커 클릭도 초점만, 헤더 AI 버튼·FAB는 명시 트리거로 유지
- 대안 카드 클릭 시 상단 지도가 해당 위치로 이동(`AlternativeCard` role=button, `mapCenter`/`selectedMarkerId` 동적 계산)

## 4. 기본 대안 추천 (CRAG/임베딩)

- `MainPlannerService.buildRecommendedAlternatives(trip, item, note?)`
  - `PlaceRetrievalService.retrieve` 로 pgvector 장소 임베딩 + 취향 벡터 개인화 + CRAG 채점 (플래너 생성과 동일 경로)
  - `currentLocation` = 항목 좌표, 음식점이면 `trigger: 'waiting'`
  - **여행 전체 일정에 이미 담긴 장소 제외**(P2-7): `itemsRepo.find({tripId})` 이름 집합으로 필터
  - **같은 카테고리 우선**, 3개 미만이면 전체 후보(CRAG 순위 보존), 최대 5개
  - 임베딩/키 미설정 등으로 비면 빈 배열 → 호출부가 mock 폴백(최소 3개)
- 표시 정직성:
  - 카드에 **실데이터** 배지, CRAG `reason`을 부가 라벨로
  - 거리 라벨: 1.5km 이내 "도보 N분", 초과 시 "N.Nkm"
  - **평점은 실제 값이 있을 때만** 별점 표시 (카카오 미제공 → 대부분 생략, 가짜 평점 제거)
  - 칩: "취향 기반 추천" + (실데이터 포함 시) "실데이터"

## 5. 항목 스코프 조건 재검색 (P3-11)

- 대안 팝업의 자유 텍스트는 **이 항목만** 다시 찾는다(동기, 비파괴적).
- `GET …/alternatives?note=<조건>` → `buildRecommendedAlternatives` 가 note 를 `trip.notes` 와 합쳐 CRAG 검색 `notes` 에 결합.
- note 검색은 mock 보충 없이 "결과 없음"을 노출. `placeholderData`(react-query)로 재검색 중 시트 깜빡임 방지.
- 헤더 "조건 반영 결과" + "'…' 반영 중 · 기본 추천으로 되돌리기" 링크.
- 일자/전체 재계획(whole-trip BullMQ replan)은 팝업에서 호출하지 않음 → 트립 레벨 진입점(후속)으로 분리.

## 6. 장소 이름 검색 → 확인 (P3-8)

- `POST …/items/:itemId/resolve-place  { query }` → `KakaoLocalService.searchByText` **상위 3곳**.
- `extractSearchKeyword`: 일반 장소명은 그대로, http(s) 지도 링크는 리다이렉트 추적 후 `q/query/keyword` 파라미터·한글 경로 세그먼트에서 키워드 추출(붙여넣기 tolerant).
- 프론트: 후보 카드 목록에서 선택("이 중 맞는 곳을 골라주세요") → 지도 확인 → "이 장소로 변경".

## 7. swap — 제약 재검증 · 카테고리 · 되돌리기

- `POST …/trips/:tripId/swap  { itemId, place }` — `place`는 좌표 포함(추천/검색 어디서 왔든 동일 형태).
- **이동시간 재계산**(P1-1): 같은 day 항목을 order 순 정렬 → 앞(prev)·뒤(next)와의 이동시간을 `RouteHelper`(car=driving, 그 외=transit, 키 없으면 로컬 추정)로 다시 계산해 `travelTimeMin` 저장.
- **실현가능성 경고**: 연속 두 일정의 시간 간격 < (앞 항목 체류 + 이동)이면 `warnings` 반환 → 시트에 경고 배너.
- **카테고리 반영**(P1-2): `place.category` 로 `item.type` 갱신 → 라벨·이모지·웨이팅 표시 정합.
- **되돌리기**(P3-10): 응답에 `previousPlace`(변경 직전 장소) 포함 → 결과 배너의 "되돌리기"가 그 값으로 재-swap. 경고 없으면 5초 뒤 자동 닫힘(스낵바형 undo 여유).

## 8. Live 화면 연동

- `views/trip-progress` 현재 일정 카드의 "웨이팅 신고" 버튼 → **"일정 변경"(대안 팝업)** 으로 교체.
- `TripProgressTimeline`: `onReportWaiting` → `onSwitchItem`, `WaitingReportSheet` → `AlternativeSheet`.
- swap 시 `planner.trip` 쿼리 무효화로 라이브 타임라인 자동 갱신.
- 이에 따라 미사용이 된 `features/report-waiting`(웨이팅 신고 → BullMQ) 제거. (백엔드 `/alternative/waiting` 엔드포인트는 유지)

## 9. 바텀시트 UX · 재계획 dedup

- 공통 `shared/ui/bottom-sheet.tsx`:
  - **X 닫기 버튼**(우상단, 항상 노출) — 지도가 상단을 채워 백드롭이 좁을 때 스크롤 없이 닫기
  - **등장 애니메이션 완화**: 이징 `cubic-bezier(0.32, 0.72, 0, 1)`, 모바일 오픈 440ms(닫힘 320ms 유지) — 급격한 easeOutQuint 로 "확" 튀던 느낌 제거
- **재계획 중복 제출 방지**(P3-12): `ReplanningService.enqueue` jobId 를 `${tripId}-${trigger}-${10초버킷}` 로 묶어 BullMQ가 연속 클릭/중복 제출을 하나의 잡으로 dedup (웨이팅·이탈·manual 모든 트리거 적용).

## 10. API / 타입

| 메서드 | 경로 | 요청 | 응답 |
| --- | --- | --- | --- |
| GET | `/main-planner/trips/:tripId/items/:itemId/alternatives` | `?note=` (선택) | `PlannerAlternativeResponseDto` |
| POST | `/main-planner/trips/:tripId/items/:itemId/resolve-place` | `{ query }` | `PlannerResolvePlaceResponseDto` |
| POST | `/main-planner/trips/:tripId/swap` | `{ itemId, place }` | `PlannerSwapResponseDto` |
| POST | `/alternative/request` (보존, UI 미사용) | `AlternativeReplanRequestBodyDto` | `ReplanJobDto` |

주요 타입 변경(`packages/types`):

- `PlannerAlternativeDto`: `rating` **optional**, `lat`/`lng`/`address?`/`category`/`origin`/`realPlace` 추가, `origin`은 `'recommend' | 'link'`
- `PlannerAlternativeResponseDto`: `realtime` 유지, `radiusMeters`/`query` 제거
- `PlannerResolvePlaceRequestDto` `{ query }` / `PlannerResolvePlaceResponseDto` `{ alternatives[], mapMarkers[] }`
- `PlannerSwapPlaceDto` `{ name, category?, address?, lat, lng, mapHref? }`, `PlannerSwapRequestDto` `{ itemId, place }`
- `PlannerSwapResponseDto`: `warnings?`, `previousPlace` 추가
- `ReplanRequestDto.note?` 추가 (whole-trip replan이 검색·프롬프트 notes 에 반영)

## 11. 정리(dead code)

- `getAlternatives` 의 `q` 분기·`buildCustomAlternatives`·`categoryCodesForItem`·`syntheticRating`
- `KakaoLocalService.searchNearbyByCategories`/`searchNearbyKeyword` (searchByText 만 잔존)
- 응답 DTO의 `radiusMeters`/`query`, 대안 카드의 가짜 평점
- 프론트 `submitSearch`/`query` 커스텀 동기검색(→ note refine 로 대체), 팝업의 whole-trip replan 호출

## 12. 검증

- web·api 타입체크 통과, API 유닛테스트 35개 통과
- `apps/api/test/main-planner/main-planner.dto.spec.ts` 확장: place 기반 swap 페이로드 유효/좌표 범위 검증
- 실제 카카오/pgvector 응답 확인은 `KAKAO_LOCAL_API_KEY`(또는 `KAKAO_REST_API_KEY`) + 임베딩 서버가 설정된 환경에서 앱 구동 필요. 키/임베딩 없으면 mock 폴백으로 동작

## 13. 후속 작업

- **트립 레벨 재계획 진입점**: 플래너 헤더에 "AI로 일정 다시 짜기"(전체/일차 스코프) → 보존한 `requestTripReplan`·`/alternative/request`(whole-trip BullMQ replan) 재사용
- **영업시간 제약**: KTO 관광정보로 후보에 영업시간을 붙여 swap 시 영업시간 위반도 경고
- **현재 장소 비교 카드**(P3-9): 시트에 바꾸기 전 원래 장소(이름·거리·카테고리) 병기
- 대안 마커 좌표 정규화(`withNormalizedMarkerPositions`)를 resolve/pending 후보에도 적용 (SDK 미로딩 폴백 일관성)
