# 여행 일정 페이지 개편(Planner Page Enhancements) v1

문서 목적: 여행 일정 페이지(`/planner`)를 "생성된 일정을 열람"하는 화면에서 **직접 편집·재계획·공유**까지 가능한 워크스페이스로 끌어올린 작업을 고정한다. 여행 삭제, 반응형(태블릿) 개편, 지도 검색·길찾기 실동작, 일정 항목 수동 편집(드래그 순서변경 포함), AI 전체 재계획, 카카오 장소 페이지 링크·place ID 저장, 일정 공유(링크 + 이미지·PDF)를 정리한다.

기준 브랜치: `feat/planner-page-enhancements`
관련 문서: [`docs/main-planner-v1.md`](./main-planner-v1.md) (플래너 초기 화면), [`docs/alternative-place-picker-v1.md`](./alternative-place-picker-v1.md) (대안 팝업·swap·재계획 plumbing), [`docs/rag-crag-v1.md`](./rag-crag-v1.md) (CRAG 검색), [`docs/trip-progress-live-v1.md`](./trip-progress-live-v1.md) (Live·재계획 수신)

## 1. 범위

포함:

- **여행 삭제**: 일정 페이지에서 이 여행 삭제 (소유자)
- **반응형(태블릿) 개편**: PC보다 좁은 태블릿에서 정보/조율 데이터 미출력 문제 해결, 사이드바 접기로 지도 영역 확보
- **아이콘 정리**: 이모지 → 설치된 `react-icons` 교체, 버튼은 아이콘 위주 (팀 컨벤션화)
- **지도 검색·길찾기 실동작**: 카카오 `keywordSearch` 실검색, 길찾기(카카오맵 link/to), 검색 결과를 **일정에 바로 반영**
- **일정 항목 수동 편집**: 추가·수정·삭제 + **드래그 & 드롭 순서변경**(`@dnd-kit/react`), 시간·메모 편집
  - 메모는 **사용자 전용**(AI 추론 근거 기본값 제거), 항목 추가는 **실제 카카오 장소**로만
- **AI 전체 재계획**: 상단 "AI 대안 제안" → 자유 텍스트 요청 + 필수 포함 장소 + 페이스/예산/이동최소화 등으로 **전체 일정 재생성**, 모바일 진입점 추가
- **카카오 장소 페이지 링크**: 일정 카드에서 카카오맵 장소 정보 페이지로 이동, place ID를 추가·swap·대안 경로 전반에 저장
- **일정 공유**: 공유 링크(공개 페이지) + 이미지·PDF 저장
- 웹(Next.js) 전용 UI + `main-planner`/`replanning` 백엔드 + 공통 타입

제외:

- 경로·이동시간 지도상 시각화(폴리라인), 내 위치로 이동 버튼 (후속)
- 이미지/PDF 내 라이브 지도 캡처 (canvas/iframe 캡처 불안정 → 텍스트 요약 카드로 대체)
- 필수 포함 장소의 LLM 경로 **보장** 주입 (best-effort 편향; fallback 경로는 반영)

## 2. 화면 구조 · 반응형

- 브레이크포인트: 모바일(탭 전환) / 태블릿(≥ md) / 와이드 데스크톱(`≥ 1536px`)
- 태블릿에서 **정보/조율 패널 미출력** 문제 해결: 데스크톱 좌측 사이드 패널이 md 이상에서 항상 렌더되도록 정리(`activeSidePanel`), 모바일은 기존 탭 유지
- **사이드바 접기**(`sidebarCollapsed`): 태블릿에서 좌측 패널을 접어 지도 영역 확보. `isWideDesktop`이면 항상 펼침
- 헤더 액션(데스크톱): 공유 · 이 여행 삭제 · AI 재계획, 모바일 헤더: 공유 아이콘 · 멤버
- `views/planner/ui/planner-view.tsx` 가 상태 오케스트레이션(tab/day/openItem/focusedItemId/swapResult/replanOpen/shareOpen/sidePanel/sidebarCollapsed 등)

## 3. 아이콘 · 지도 검색/길찾기

- 이모지 → `react-icons`(주로 `fi`/`lu`) 교체, 버튼은 아이콘 위주 컨벤션으로 정착
- 검색 placeholder "여행 검색" → "장소 검색"
- `widgets/planner-map`:
  - **검색**: 카카오 `services.Places.keywordSearch` 실동작, 결과 마커(인라인 SVG 핀)
  - **길찾기**: 카카오맵 route 렌더 API 부재 → `https://map.kakao.com/link/to/{name},{lat},{lng}` 링크(`FiNavigation`)
  - **검색 → 일정 반영**: `onPickSearchPlace`(place ID 포함)로 검색 결과를 일정 항목 추가에 연결
- `shared/lib/use-kakao-place-search.ts` — `useKakaoPlaceSearch` + `toResolvedPlace`(`place.id` → `kakaoPlaceId`)로 검색 로직 공용화, `kakao-loader.ts`가 `services` 라이브러리 로드

## 4. 일정 항목 수동 편집 (`features/edit-itinerary`)

- `useItineraryItems` — add/update/delete/reorder 뮤테이션, 성공 시 `planner.trip` 무효화 (FSD: 뮤테이션은 features 안에서만)
- `EditableTimeline` — `PlannerTimeline` 대체. `DragDropProvider` + `useSortable({id, index})`로 순서변경, 추가 버튼, 삭제 확인, 순서변경 안내 배너
- **드래그 핸들**: 별도 분리된 외부 영역이 좁게 느껴지는 문제 → **카드 내부 좌측 스트립**(`rounded-l-[15px]`, `LuGripVertical`)으로 통합, 사용자 인지용 안내
- `ItemEditorSheet` — 추가 모드는 카카오 `PlaceSearchField`로 **실제 장소만**, 수정 모드는 이름 readonly(실장소 보존), 시간·메모 편집. `ItemEditorValues`에 `kakaoPlaceId?`
- **메모 사용자 전용화**: 생성 단계(`planner.service.ts`)에서 `toStore`의 memo 주입 제거 → 메모는 빈 상태로 시작, 사용자가 직접 입력. 백엔드 메모 클리어는 `null` 사용(`exactOptionalPropertyTypes` 대응)
- **변경 버튼**: 카드 우상단 `ChangeScheduleButton`에 "변경" 라벨 추가, hover 툴팁 클리핑 해결(카드 `overflow-hidden` 제거 + 스트립 모서리 라운딩으로 대체)

### 백엔드 항목 CRUD (`main-planner`)

- `addItem` / `updateItem` / `deleteItem` / `reorderItems` + 헬퍼(`itemsPerDayForPace`, `combineScheduledAt`, `dayBaseDate`, `kstDateString`, `resequenceDay`, `recomputeDayTravelTimes`, `DEFAULT_COORDINATES`)
- 라우트 충돌 방지: `PATCH items/reorder`를 `PATCH items/:itemId`보다 **먼저** 선언(reorder가 itemId로 잡히지 않도록)
- `toPlannerItem` 에 `durationMin`/`memo`/`kakaoPlaceId` 포함

## 5. AI 전체 재계획 (`features/request-replan`)

- 상단 "AI 대안 제안" → **완전한 재계획** 진입점으로 승격, 모바일에도 추가
- `ReplanModal` 입력:
  - **자유 텍스트**(예: "카페는 1곳만 가고싶어요") — note
  - **필수 포함 장소**(`MustIncludePicker`, 카카오 검색)
  - **페이스**(relaxed/balanced/packed) · **예산**(thrifty/normal/premium) SegmentToggle
  - **피하고 싶은 것**(avoid) · **이동 최소화**(minimizeTravel) Switch
- `useRequestReplan` → `/alternative/request`(기존 BullMQ replan 파이프라인 재사용) → `plannerService.replan` → 전체 재생성 → WebSocket `pushReplanResult` → `useReplanSubscription`이 `planner.trip` 무효화
- 백엔드: `GenerateOptions`/`replan()`에 `mustIncludePlaces`/`preferences` 반영. `buildCombinedNotes`(trip.notes + 옵션), `buildMustIncludeCandidates`(후보 상위 시드 + note 편향), `PACE_HINT`/`BUDGET_HINT`, 페이스별 `itemsPerDay`
- 필수 포함은 **best-effort**: 후보 최상위 시드 + 강한 note 편향(LLM 경로는 보장 아님, fallback 경로는 반영)

## 6. 카카오 장소 페이지 링크 · place ID

- 일정 카드 하단에 카카오맵 링크(`카카오맵`, `LuExternalLink`): `kakaoPlaceUrl(item)` = `kakaoPlaceId` 있으면 `https://place.map.kakao.com/{id}`, 없으면 `https://map.kakao.com/link/search/{name}`
- **place ID 저장 경로 확장**:
  - 항목 추가: `PlannerAddItemRequestDto.kakaoPlaceId`
  - swap: `(item as {kakaoPlaceId?}).kakaoPlaceId = place.kakaoPlaceId ?? null`
  - 대안(`PlannerAlternativeDto.kakaoPlaceId`)·검색 결과(`toResolvedPlace`) 전반
- 이로써 추가·치환된 항목도 정확한 카카오 장소 페이지로 연결

## 7. 일정 공유 (`features/share-trip`)

- **링크 공유**(소유자): `TripEntity.shareToken`(unique) 발급(`randomBytes(12).toString('base64url')`) → 공개 페이지 `/share/{token}`
  - 활성/비활성/상태 엔드포인트(owner 전용) + **가드 없는 공개 컨트롤러** `SharedItineraryController`(`GET /shared-itineraries/:token`)
  - `getSharedItinerary(token)` → `SharedItineraryDto`(title/destination/durationLabel/transportLabel/memberCount/days/items/mapCenter/mapMarkers)
  - JwtAuthGuard가 컨트롤러 단위이므로, 가드를 뺀 별도 컨트롤러로 무인증 열람 구현
- **공개 뷰** `views/shared-trip` — 읽기 전용(헤더·지도·일차 선택·카드·카카오 링크 + "나도 여행 만들기" CTA), `retry:false`로 만료/중지 안내
- **이미지·PDF 저장**(누구나): `lib/export-node.ts`(`html-to-image` `toPng` → `jspdf`), 오프스크린 `ShareableItinerary`(width 720 텍스트 요약 카드)를 캡처 대상으로 사용 → 라이브 지도 canvas 캡처 회피
- `ShareTripSheet`(open/onClose/tripId/tripTitle/subtitle/days/items/canShareLink) — 상태 쿼리 + enable/disable 뮤테이션, 복사·`navigator.share`·PNG/PDF. `canShareLink={trip.isOwner}`로 링크 섹션 게이팅
- 데스크톱 헤더 공유 버튼 + 모바일 헤더 `LuShare2`

## 8. API / 타입

| 메서드 | 경로 | 요청 | 응답 |
| --- | --- | --- | --- |
| DELETE | `/main-planner/trips/:tripId` | — | 삭제 |
| POST | `/main-planner/trips/:tripId/items` | `PlannerAddItemBodyDto` | 항목 |
| PATCH | `/main-planner/trips/:tripId/items/reorder` | `PlannerReorderItemsBodyDto` | 정렬 |
| PATCH | `/main-planner/trips/:tripId/items/:itemId` | `PlannerUpdateItemBodyDto` | 항목 |
| DELETE | `/main-planner/trips/:tripId/items/:itemId` | — | 삭제 |
| GET/POST/DELETE | `/main-planner/trips/:tripId/share` | — | `{ token }` / `TripShareResponseDto` |
| GET | `/shared-itineraries/:token` (공개, 무인증) | — | `SharedItineraryDto` |
| POST | `/alternative/request` (전체 재계획) | `mustIncludePlaces`/`preferences` 확장 | `ReplanJobDto` |

주요 타입 변경(`packages/types`):

- `main-planner.ts`: `PlannerTripDto.isOwner`; `PlannerItineraryItemDto.durationMin`/`.memo?`/`.kakaoPlaceId?`; `PlannerAddItemRequestDto`/`PlannerUpdateItemRequestDto`/`PlannerReorderItemsRequestDto`; `PlannerSwapPlaceDto.kakaoPlaceId?`; `PlannerAlternativeDto.kakaoPlaceId?`; `TripShareResponseDto`; `SharedItineraryDto`
- `replanning.ts`: `ReplanPace`/`ReplanBudget`/`ReplanPlaceDto`/`ReplanPreferencesDto`, `ReplanRequestDto`에 `mustIncludePlaces?`/`preferences?`

## 9. 정리 · 주의

- `exactOptionalPropertyTypes`: optional에 `undefined` 대입 금지 → 조건부 스프레드(`...(x ? {k:x} : {})`), 클리어는 key destructure 또는 `null` 사용
- 운영 배포: `shareToken` 컬럼은 dev `synchronize`로만 생성됨 → **프로덕션은 마이그레이션 필요**. 공개 페이지가 API를 호출하므로 CORS에 웹 오리진 허용 필요
- 이미지/PDF는 라이브 지도 대신 텍스트 요약 카드 캡처

## 10. 검증

- web·api 타입체크 통과(`tsc --noEmit`), 프로덕션 빌드 통과(`/share/[token]` 동적 라우트 등록 확인)
- 실제 링크 공유·이미지/PDF·재계획 동작 확인은 API + Redis + `KAKAO_*` 키가 설정된 로컬 구동 필요

## 11. 후속 작업

- 경로·이동시간 지도 시각화(폴리라인) · 내 위치로 이동 버튼
- 검색 드롭다운 키보드 내비게이션, 태블릿 사이드바 접힘 상태 localStorage 유지
- 필수 포함 장소의 LLM 경로 보장 주입(현재 best-effort)
- 공유 링크 만료/조회수·이미지 카드에 QR
