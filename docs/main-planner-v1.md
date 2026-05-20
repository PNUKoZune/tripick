# TriPick Screen 3 (Main Planner) / Screen 4 (Alternative Popup) v1

문서 목적: Figma `AI Travel Planner – Prototype` 의 Screen 3·4 를 v1 web에 어떻게 옮겼는지를 고정한다. 디자인 시스템, 반응형 전략, FSD 구조, mock API 명세, 화면별 매핑 규칙을 같이 정리한다.

기준 브랜치: `feature/main-plan-page`
기준 Figma: `https://www.figma.com/design/M7C2pQ6bsb2ODlNrbkMEhM` · 노드 `Screen 3 (6:80)` · `Screen 4 (6:162)`
기준 디자인 시스템: [`docs/design-system/toss-v1.md`](./design-system/toss-v1.md)

## 1. 범위

포함:
- Screen 3 메인 플래너 (헤더 / 지도 / 탭 / 일차 / 타임라인 / 하단 네비)
- Screen 4 대안 추천 바텀시트 (사유 안내 / 반경 칩 / AI 추천 카드 / 원래 유지·대안 변경 CTA)
- 정보 탭 (여행 개요, 취향 태그, 일정 통계, 단기 날씨 mock)
- 지도 탭 (큰 카카오맵 + 콤팩트 일정 리스트 + 마커↔카드 양방향 하이라이트)
- 내 여행 목록 페이지 `/trips` (다중 여행 카드 + 상태 필터 + 통계)
- 데스크탑(≥ `lg`) 웹 레이아웃 (상단 헤더 + 좌측 일정 + 중앙 큰 지도 + xl 우측 정보)
- 실제 카카오맵 SDK 동적 로드 + 폴백 미리보기
- mock backend API (`/api/v1/main-planner/*`)
- 웹(Next.js) 전용 구현

제외:
- React Native 모바일 적용
- 실시간 WebSocket 연동 (mock REST 만 사용)
- 인증/세션 연결 (mock controller 는 가드 없음)

## 2. 디자인 시스템 적용 매핑

toss-v1.md `3. 색상 규칙` 의 역할 색상만 사용한다. Figma 의 brand orange 는 가져오지 않는다.

| 토큰                   | 사용 위치                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `background #F7F8FA`   | 페이지 바깥 캔버스, 데스크탑 사이드 패널 배경                                        |
| `surface #FFFFFF`      | 모바일 셸, 카드, sheet body                                                          |
| `surface-muted #FAFBFC`| sub card, 빈 상태/안내 메시지, 컨텍스트 타일                                         |
| `primary #3182F6`      | 활성 day chip, 활성 tab underline, AI 버튼, primary CTA, 마커 dot, 포커스 카드 border|
| `primary-pressed #1B64DA` | 활성 chip text, primary hover, 포커스된 마커 라벨                                  |
| `success #00A86B`      | "실시간 반영" chip, 카테고리 톤 (mint 계열), 변경 완료 안내                          |
| `warning #FF8A00`      | 별점 ★ 아이콘, "지금 바로" 배지(긴급 톤)                                              |
| `error #F04452`        | "!" 배지, ⚠ 웨이팅 텍스트, 현재 위치 마커, 에러 상태                                 |
| `divider #E5E8EB`      | 모든 카드 border, tab divider                                                        |

규칙 확인:
- card radius `20px / 16px` 만 사용 → `SurfaceCard`, `ItineraryItemCard`, `AlternativeCard`
- primary CTA 1개 원칙 → Screen 4 하단은 `secondary(원래 유지) + primary(대안 변경)` 한 쌍
- input/button 높이 `56/52/48` 체계 → Button `lg=56`, `md=48`
- chip radius `14px`, min-height `44px` → `Chip` + `SegmentToggle`
- "장식용 포인트 색상 2개 이상 동시 사용 금지" → 카테고리 톤(`AlternativeCard`)도 `neutral / primary / success` 세 가지 역할 색상으로만 표현

## 2-1. 반응형 전략

mobile-first 셸과 데스크탑 웹 레이아웃을 별도 트리로 렌더해 같은 view-model 을 공유한다. `/planner` (Screen 3·4) 와 `/trips` (내 여행 목록) 두 페이지 모두 동일한 임계를 사용한다.

| 구분             | 임계         | `/planner`                                                                          | `/trips`                                                        |
| ---------------- | ------------ | ----------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| mobile (< `lg`)  | < 1024px     | 480px 폰 셸 1개. 헤더 → 지도 → 탭(일정/지도/정보) → 일차 → 본문 → 하단 4-tab 네비   | 480px 폰 셸. 헤더 + 통계 3칸 + 상태 필터 + 카드 세로 리스트     |
| desktop (≥ `lg`) | ≥ 1024px     | 상단 헤더 + `grid-cols-[380px_1fr]` (좌측 일정 / 중앙 큰 지도)                      | 상단 헤더 + 통계 4칸 + 필터 + `grid-cols-2` 카드 그리드         |
| wide (≥ `xl`)    | ≥ 1280px     | 상단 헤더 + `grid-cols-[420px_1fr_360px]` (좌측 일정 / 중앙 지도 / 우측 정보)       | `grid-cols-3` 카드 그리드                                       |

- 데스크탑에서는 탭/하단 네비를 제거하고 일정·지도·정보 패널을 동시에 노출. 모바일 셸에서만 탭 인터랙션을 사용.
- 모든 데스크탑 패널 높이는 `h-[calc(100dvh-120px)]` (헤더 72 + 컨테이너 padding 48) 로 고정해 스크롤 영역을 한 칸씩 분리.
- 데스크탑 인터랙션: `focusedItemId` 상태를 공유해
  - 일정 카드 1차 클릭 → 마커/카드 하이라이트 + 지도 이동
  - 같은 항목 2차 클릭 → 대안 시트 오픈
  - 지도 마커 클릭도 동일 패턴(첫 클릭 포커스, 두 번째 클릭 시트)
- 모바일 폰 셸에서는 기존대로 클릭 1회로 즉시 시트 오픈.

## 3. FSD 디렉터리 구조

```
apps/web/src/
├── app/
│   ├── planner/page.tsx              # Screen 3·4 라우트 → views/planner
│   └── trips/page.tsx                # 내 여행 목록 라우트 → views/trips
│
├── views/                            # 라우트 컴포지션 (FSD 7.x)
│   ├── trips/                        # /, /trips — TripsView
│   └── planner/                      # /planner — PlannerView
│
├── widgets/                          # 재사용 가능한 UI 블록
│   ├── planner-header/               # 상단 타이틀 + 멤버 아바타
│   ├── planner-map/                  # 카카오맵 SDK + 폴백 + 마커 오버레이
│   ├── planner-timeline/             # day 별 타임라인 리스트 (선택 상태 지원)
│   ├── planner-bottom-nav/           # 홈/지도/내 여행/프로필 (Next Link 연결)
│   ├── alternative-sheet/            # Screen 4 바텀시트
│   ├── trip-info-panel/              # 정보 탭 / 데스크탑 우측 패널
│   └── trip-map-panel/               # 모바일 지도 탭 (큰 지도 + 콤팩트 리스트)
│
├── features/
│   ├── planner-tab-switch/           # 일정/지도/정보 탭 (모바일)
│   ├── day-selector/                 # 1일차/2일차 segment
│   └── select-alternative/           # 대안 fetch + 선택 + swap hook
│
├── entities/
│   ├── trip-plan/                    # Trip mock API client + TripSummaryCard
│   ├── itinerary-item/               # ItineraryItemCard (선택 상태 prop)
│   ├── alternative/                  # AlternativeCard
│   └── member/                       # MemberAvatars
│
└── shared/
    ├── ui/                           # SurfaceCard, Chip, Button, BottomSheet, SegmentToggle
    ├── lib/                          # api re-export + kakao-loader
    └── config/design-tokens.ts       # toss-v1 토큰 코드화
```

규칙:
- import 방향: `entities` → `features` → `widgets` → `views` → `app`
- 라우트 단위의 페이지 composition 은 `views/<route>/ui/<route>-view.tsx` 에 두고, 컴포넌트명은 `*View` 로 통일 (`TripsView`, `PlannerView`). 동료의 landing/preferences/members/coordination 패턴과 동일.
- `widgets/` 는 여러 view 에서 재사용 가능한 블록만. 라우트별 화면 조립은 `widgets/` 에 두지 않는다.
- shared/ui 는 어떤 도메인에도 종속되지 않는 primitive 만 둔다.
- 도메인 hook (예: `useAlternativeController`)은 widget 이 아닌 feature 에 위치시킨다.
- mock 의존이 강한 헬퍼는 `entities/trip-plan/api.ts` 한 군데에만 둔다.

## 3-1. Kakao Maps 연동

`widgets/planner-map` 은 `shared/lib/kakao-loader.ts` 의 `loadKakaoMaps()` 로 SDK 를 1회만 동적 로드한다.

- 환경변수 `NEXT_PUBLIC_KAKAO_MAP_KEY` 가 비어 있으면 SDK 로드를 시도하지 않고 폴백 미리보기를 렌더한다.
- 키가 있을 때만 `https://dapi.kakao.com/v2/maps/sdk.js?...&autoload=false` 를 head 에 주입한다. `app/layout.tsx` 에 SDK script 가 박혀 있지 않다.
- `PlannerTripDto.mapCenter`, `PlannerMapMarkerDto.lat/lng` 가 실제 좌표를 담는다. 폴백을 위해 normalized `x/y` 도 함께 직렬화한다.
- 마커는 `CustomOverlay` 로 그려 toss-v1 토큰의 dot/label 스타일을 그대로 유지한다.
- `selectedMarkerId` prop 으로 강조 상태를 외부 제어, `onMarkerClick` 으로 컨테이너에 클릭 위임.

레이아웃 모드:
- `aspect` prop (기본): outer 는 auto, inner 는 `aspect-*` 비율 → 폰 셸·바텀시트에서 사용
- `fill` prop: outer + inner 모두 `h-full w-full` → 데스크탑 그리드 셀의 정해진 높이를 채울 때 사용

안정성:
- 마운트 직후 컨테이너가 0×0 이면 `requestAnimationFrame` 으로 폴링한 뒤 SDK 초기화 → 그리드/플렉스의 늦은 사이즈 결정 대응
- ResizeObserver 로 컨테이너 사이즈 변화 시 `map.relayout()` + `setCenter` 호출 → 패널 토글/창 리사이즈에도 타일 정상 렌더

설정 절차:
1. 카카오 디벨로퍼스에서 JavaScript 키 발급, web 플랫폼 도메인 등록
2. `apps/web/.env.local` 에 `NEXT_PUBLIC_KAKAO_MAP_KEY=<키>` 추가
3. `pnpm --filter @tripick/web dev` 재시작

## 4. mock API 명세

base URL: `http://localhost:4000/api/v1/main-planner`
모듈: [`apps/api/src/main-planner/`](../apps/api/src/main-planner)

| Method | Path                                                    | 응답                              |
| ------ | ------------------------------------------------------- | --------------------------------- |
| GET    | `/trips`                                                | `TripSummaryDto[]`                |
| GET    | `/trips/:tripId`                                        | `PlannerTripDto`                  |
| GET    | `/trips/:tripId/items/:itemId/alternatives`             | `PlannerAlternativeResponseDto`   |
| POST   | `/trips/:tripId/swap` body `{ itemId, alternativeId }`  | `PlannerSwapResponseDto`          |

데모 고정 식별자:
- 상세 mock 보유 `tripId = demo-gyeongju-1n2d` (Screen 3 진입 가능)
- 목록 mock 추가 trip: `demo-busan-2n3d` / `demo-jeju-3n4d` / `demo-gangneung-day` (요약만, 상세 미연결 카드는 클릭 비활성)
- alternative mock 등록 itemId: `item-cheomseongdae` / `item-hwang-cafe` / `item-gyori` / `item-bulguksa` (현재 day 의 4개 일정 모두)

DTO 정의: [`packages/types/src/main-planner.ts`](../packages/types/src/main-planner.ts)
mock fixture: [`apps/api/src/main-planner/main-planner.mock.ts`](../apps/api/src/main-planner/main-planner.mock.ts)

추가된 DTO:
- `PlannerTripMetaDto` — 정보 탭 메타(기간, 이동 수단, 기상/취침, 취향 태그, 통계, 단기 날씨)
- `PlannerWeatherDto` — 일자별 emoji + 최고/최저 라벨
- `PlannerMapMarkerDto.itemId` — 마커 ↔ itinerary 항목 매핑 키
- `PlannerMapCenterDto` — 지도 초기 중심/줌 레벨
- `TripSummaryDto` + `TripSummaryStatus` — 내 여행 목록 카드용 (제목, 기간, 상태, 멤버, hasDetail 등). `trip.ts` 의 `TripStatus` 와 구분

특징:
- 인증 guard 미적용 → 데모 토큰 없이도 호출 가능
- BullMQ / DB 의존 없음 → planner / replanning 정식 파이프라인과 분리
- `realtime: true` 플래그로 Screen 4 의 "실시간 반영" 칩을 켠다
- 웨이팅 없는 항목은 `waitingMinutes: 0` + `realtime: false` 로 "비슷한 다른 장소" 톤으로 표시

## 5. 화면 컴포넌트 매핑

### Screen 3 (Main Planner) — 모바일 셸

| Figma 영역             | 컴포넌트                                                  |
| ---------------------- | --------------------------------------------------------- |
| 상단 타이틀 + 멤버 dot | `widgets/planner-header`                                  |
| 지도 + 검색바 + 마커   | `widgets/planner-map` (aspect 모드)                       |
| 일정/지도/정보 탭      | `features/planner-tab-switch`                             |
| 1일차/2일차 segment    | `features/day-selector` + `shared/ui/SegmentToggle`       |
| 일정 탭 타임라인        | `widgets/planner-timeline` → `entities/itinerary-item`    |
| 지도 탭                | `widgets/trip-map-panel` (큰 지도 + 콤팩트 row 리스트)    |
| 정보 탭                | `widgets/trip-info-panel` (개요/취향/통계/날씨)            |
| AI 플로팅 버튼          | `views/planner` 내부 fixed 버튼 (웨이팅 항목 우선) |
| 하단 4-tab 내비         | `widgets/planner-bottom-nav`                              |

### Screen 3 — 데스크탑 (≥ `lg`)

| 영역                   | 컴포넌트                                                  |
| ---------------------- | --------------------------------------------------------- |
| 상단 헤더              | `views/planner` 인라인 (제목, 기간 칩, 멤버, AI CTA)|
| 좌측 일정 패널          | `features/day-selector` + `widgets/planner-timeline`      |
| 중앙 큰 지도            | `widgets/planner-map` (`fill` 모드)                       |
| 우측 정보 패널 (xl+)    | `widgets/trip-info-panel`                                 |

### My Trips 페이지 (`/trips`)

| 영역                       | 컴포넌트                                              |
| -------------------------- | ----------------------------------------------------- |
| 상단 헤더 (브랜드 / CTA)   | `views/trips` 인라인                       |
| 통계 타일 (전체/곧/초안/끝)| 인라인 `SummaryTile`                                  |
| 상태 필터 chip             | 인라인 `FilterBar` (`all/upcoming/ongoing/draft/done`)|
| 여행 카드                  | `entities/trip-plan/TripSummaryCard` (Next `Link`)    |
| 빈 상태                    | 인라인 `EmptyState`                                   |
| 하단 4-tab 네비 (모바일)   | `widgets/planner-bottom-nav` (`active="trips"`)       |

- `hasDetail=true` 인 카드만 `/planner?tripId=...` 로 링크. 나머지는 정적 카드(점선 안내 박스).
- bottom nav 는 `next/link` 기반이라 `/trips ↔ /planner` 간 이동이 자연스럽다.

### Screen 4 (Alternative Popup)

| Figma 영역                              | 컴포넌트                            |
| --------------------------------------- | ----------------------------------- |
| 상단 지도(현재 + 대안 마커)             | `BottomSheet.topSlot` + `PlannerMap`|
| 헤더(웨이팅이 길어요 / 비슷한 다른 장소)| `AlternativeSheet` 내부 헤더        |
| "카카오맵 기준 반경 Nm 내" chip         | 인라인 chip (`primary`)             |
| "AI 추천 대안" + "실시간 반영" 배지     | section 헤더 + `Chip` (`success`)   |
| 대안 카드 3종                           | `entities/alternative/AlternativeCard` |
| 하단 "원래 유지" + "대안으로 변경"      | `shared/ui/Button` 2개 row          |

### BottomSheet 모션

- 4단계 phase 머신(`closed → opening → open → closing`)
- 더블 `requestAnimationFrame` 으로 첫 페인트는 `translate-y-full`, 다음 프레임에 `translate-y-0` 적용 → 트랜지션 보장
- 320ms, 열기 `cubic-bezier(0.22, 1, 0.36, 1)` / 닫기 `cubic-bezier(0.4, 0, 1, 1)`
- `translate3d` + `willChange: transform` 으로 GPU 합성
- 시트 본문/topSlot 은 데이터 로딩 중에도 같은 높이(`aspect-[16/9]` 지도 슬롯 + `min-h-[420px]` 본문) 의 스켈레톤을 렌더 → 레이아웃 점프 제거

## 6. 사용자 플로우

1. `/planner` 라우트 진입 → `fetchPlannerTrip(DEMO_TRIP_ID)` 호출
2. 응답으로 헤더·지도·일자·타임라인·정보·날씨가 채워진다.
3. **모바일**: 타임라인 카드를 누르거나 AI 플로팅 버튼을 누르면 해당 itemId 로 `AlternativeSheet` 가 열린다.
4. **데스크탑**: 타임라인 카드/마커 첫 클릭은 포커스(지도 이동 + 카드 강조), 같은 항목 두 번째 클릭에서 시트가 열린다. 헤더의 `AI 대안 제안` 버튼은 웨이팅 항목 우선으로 시트를 연다.
5. 시트는 `fetchPlannerAlternatives` 를 호출해 대안 3개 + 지도 마커를 받아온다. 로딩 중 스켈레톤.
6. "대안으로 변경" → `swapPlannerItem` 호출 → 응답의 `newItemName` 을 타임라인 항목에 즉시 반영, 시트 닫기.
7. "원래 일정 유지" → 시트만 닫고 일정은 변경되지 않는다.

mock 한정 동작:
- 어떤 itemId 든 alternatives 가 있어 시트가 정상 동작한다. 매핑 외 itemId 에 한해 404.
- swap 결과는 in-memory 상태에만 반영된다 (페이지 새로고침 시 원복).

## 7. 검증

```bash
pnpm --filter @tripick/types build
pnpm --filter @tripick/api typecheck
pnpm --filter @tripick/web typecheck
```

세 명령 모두 통과해야 한다. 2026-05-12 기준 통과 확인.

수동 검증 절차:
1. `pnpm --filter @tripick/api dev` 로 API 4000 포트 기동
2. `pnpm --filter @tripick/web dev` 로 Next.js 3000 포트 기동
3. `http://localhost:3000/trips` 접속 → 4개 여행 카드 + 통계/필터 노출 확인
4. 경주 1박 2일 카드 클릭 → `/planner` 진입
5. 모바일 뷰 (< 1024px): 일정/지도/정보 탭 전환, 카드 클릭 시 시트 슬라이드 업 확인, 하단 `내 여행` 탭으로 `/trips` 복귀 확인
6. 데스크탑 뷰 (≥ 1024px): 좌측 카드 클릭 → 중앙 지도 이동 + 마커 강조 → 한 번 더 클릭 시 시트 오픈
7. `/trips` 데스크탑 (≥ 1280px): 카드 3열 그리드, 상태 필터 동작 확인
8. `NEXT_PUBLIC_KAKAO_MAP_KEY` 설정 후 실 지도 렌더, 미설정 시 폴백 미리보기 확인

## 8. 후속 작업 (backlog)

- planner 모듈의 실제 itinerary 와 fixture 통합 (단일 API surface 로 통합)
- WebSocket `replan_result` 채널 연동 → swap 결과를 실시간 반영
- 카카오맵 Polyline 으로 day 동선 시각화
- 기상청 단기예보 실연동 (지금은 mock)
- `/trips` 의 카드들 모두에 상세 mock 추가 → 다중 trip 진입 가능
- `/planner` 라우트가 `?tripId` 쿼리 파라미터를 실제로 반영하도록 확장 (현재는 demo 1건 고정)
- 새 여행 만들기 플로우 (`/trips/new`)
- 모바일(React Native) 동일 화면 이식

## 9. 결정 요약

1. v1 Screen 3/4 는 mock REST 만으로 완결시킨다.
2. UI 톤은 toss-v1.md 토큰만 사용하고, Figma 의 brand orange 는 도입하지 않는다.
3. FSD 5-layer 를 그대로 따르고, 도메인 hook 은 feature 에만 둔다.
4. 폰 셸과 데스크탑 웹 레이아웃은 별도 트리로 분리해 web 의 가로 공간을 활용한다.
5. 카카오맵 SDK 는 동적 로드 + 폴백 + ResizeObserver 로 늦은 레이아웃에도 안전하게 렌더한다.
6. 대안 변경은 in-memory 로만 반영하고, 새로고침 시 원복되는 한계는 문서화한다.
7. 다중 여행 관리는 별도 라우트 `/trips` 로 분리하고, 상세 mock 이 없는 trip 카드는 클릭 비활성으로 명시한다.
