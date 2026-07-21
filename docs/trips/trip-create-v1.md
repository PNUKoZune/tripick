# TriPick 새 여행 만들기 v1

문서 목적: `/trips/new` 경로의 신규 여행 생성 플로우(웹 전용, mock 백엔드)가 기존 main-planner v1 구조 위에 어떻게 얹혔는지를 고정한다. 디자인 토큰·FSD 레이어·mock API 명세·필드 정의를 모아둔다.

기준 브랜치: `feat/add-trip`
선행 문서: [`docs/planner/main-planner-v1.md`](../planner/main-planner-v1.md) (Screen 3·4·내 여행 목록)
기준 디자인 시스템: [`docs/design-system/toss-v1.md`](../design-system/toss-v1.md)

## 1. 범위

포함:
- `/trips/new` 라우트 (모바일 셸 + 데스크탑 카드 레이아웃)
- 자동완성 기반 여행 지역 입력 (`features/destination-search`)
- react-day-picker(v10) range 모드 달력 + 토스 톤 오버라이드
- 커스텀 시각 드롭다운(`TimeSelect`) — 시(24) × 분(00·15·30·45)
- 동행자 칩 + 이니셜 입력
- 선택 메모 텍스트영역 (최대 200자) — AI 일정 생성에 반영될 자유 입력
- mock backend: `GET /destinations`, `POST /trips` (in-memory append)
- `/trips`(모바일·데스크탑) 및 빈 상태 CTA 에서 `/trips/new` 진입 동선

제외:
- 인증/세션 (mock controller 가드 없음)
- 실제 LLM 일정 생성 (생성된 trip 은 상세 mock 미보유 → `hasDetail: false`)
- 결과 trip 의 상세(`/planner?tripId=…`) 진입 — 후속 작업
- React Native 화면 이식

## 2. UX 결정 요약

- "한 화면 폼"으로 끝낸다. 다단계 마법사 미도입.
- 모바일은 하단 고정 액션바(`fixed bottom-[66px]`)로 1차 CTA 노출, 데스크탑은 헤더 우측에 동일 CTA 배치.
- 날짜는 인라인 1개월 range 달력. 종일/박수 라벨은 달력 상단 요약 카드에 결합.
- 시각은 30분 간격이 아닌 15분 간격으로 결정. 24×4 = 96 조합을 두 컬럼 스크롤로 노출.
- 커버 이모지·태그 등은 초안 단계에서 생략. mock 백엔드가 기본 `🧳` 으로 채운다.
- 자유 입력 메모(`notes`)는 선택 항목. 입력 시 mock 목록 카드의 `highlight` 로 노출되어 즉시 피드백을 준다.

## 3. 디자인 시스템 적용 매핑

main-planner v1 과 동일한 toss-v1 토큰만 사용한다.

| 토큰                      | 사용 위치                                                    |
| ------------------------- | ------------------------------------------------------------ |
| `background #F7F8FA`      | 페이지 캔버스                                                 |
| `surface #FFFFFF`         | 폼 카드, 달력 컨테이너, 자동완성 패널                         |
| `surface-muted #FAFBFC`   | 시각 드롭다운 hover, 보조 hover                               |
| `primary #3182F6`         | CTA, 활성 칩, 자동완성 선택, 달력 range 양끝, 시각 드롭다운 활성 |
| `primary-pressed #1B64DA` | CTA hover, 시각 드롭다운 활성 텍스트                          |
| `divider #E5E8EB`         | 입력 border, 카드 border, 달력 컨테이너 border                |
| `error #F04452`           | 동일 일자 시 도착<출발 검증 에러, 폼 에러 박스                 |
| `text/secondary #6B7684`  | 필드 label, 시각 컬럼 헤더                                    |
| `text/tertiary #8B95A1`   | 힌트 텍스트, 글자 수 카운터                                   |
| `placeholder #B0B8C1`     | input placeholder, disabled icon                              |

달력 톤(react-day-picker) 오버라이드: [`apps/web/src/views/trip-create/ui/trip-create-calendar.css`](../../apps/web/src/views/trip-create/ui/trip-create-calendar.css)
- `--rdp-accent-color: #3182F6`
- `--rdp-range_middle-background-color: #EAF2FF`
- `--rdp-day_button-border-radius: 12px`
- range 양끝(`.rdp-range_start/end`)은 primary 채움, 중간은 `#EAF2FF` 띠

## 4. FSD 디렉터리 구조 (이 화면 추가분)

```
apps/web/src/
├── app/
│   └── trips/new/page.tsx                          # /trips/new 라우트 → views/trip-create
│
├── views/trip-create/                              # 라우트 컴포지션
│   └── ui/
│       ├── trip-create-view.tsx                    # TripCreateView (모바일 셸 + 데스크탑 카드)
│       ├── trip-create-calendar.css                # react-day-picker 토스 톤 오버라이드
│       └── time-select.tsx                         # 시·분 드롭다운
│
├── features/destination-search/                    # 자동완성 콤보박스
│   ├── index.ts
│   └── ui/destination-search-input.tsx             # 180ms debounce + React Query
│
└── entities/trip-plan/                             # API 추가
    ├── api.ts                                      # + fetchDestinationSuggestions / createTrip
    └── index.ts                                    # + DestinationSuggestion / CreateTripInput 타입 재노출
```

규칙(main-planner v1 와 동일):
- import 방향: `entities` → `features` → `widgets` → `views` → `app`
- 라우트 단위 화면 조립은 `views/<route>/ui/<route>-view.tsx`. 컴포넌트명은 `*View`.
- `TimeSelect` 는 trip-create 전용으로 한정해 colocate. 재사용 수요 발생 시 `shared/ui` 로 승격한다.
- `DestinationSearchInput` 은 feature 로 두어 다른 view 에서도 재사용 가능하게 한다 (예: 후속 검색바).

### 4-1. react-day-picker

- 버전 `^10` + `date-fns` 사용.
- 로케일: `react-day-picker/locale` 의 `ko` 직접 import → 별도 dayjs 의존 없이 한글 라벨.
- 스타일: `react-day-picker/style.css` 임포트 후 `trip-create-calendar.css` 로 토큰 오버라이드.
- `mode="range"` + 단일 월. 모바일 셸 폭(`max-w-[430px]`) 안에 정확히 들어가도록 `numberOfMonths={1}`.

### 4-2. TimeSelect

- `value: "HH:mm"` 문자열 in/out — 기존 input[type=time] 과 동일한 직렬화 유지.
- 입력값이 15분 step 이 아닐 경우 가장 가까운 옵션으로 스냅(`snapToStep`).
- 열림 직후 `scrollIntoView({ block: 'center' })` 로 현재 선택값을 가운데로.
- 외부 클릭 닫힘, `aria-expanded` / `role="listbox"` / `role="option"` / `aria-selected` 부착.

## 5. mock API 명세

base URL: `http://localhost:4000/api/v1/main-planner`
모듈: [`apps/api/src/main-planner/`](../../apps/api/src/main-planner)

| Method | Path                          | 응답                          |
| ------ | ----------------------------- | ----------------------------- |
| GET    | `/destinations?q=…`           | `DestinationSuggestionDto[]`  |
| POST   | `/trips` (body 아래)          | `TripSummaryDto`              |

### 5-1. `GET /destinations`

- `q` 가 비어 있으면 상위 8개 기본 노출.
- `name` / `region` 부분일치 (대소문자 무시), 최대 10개 반환.
- fixture: [`apps/api/src/main-planner/destinations.mock.ts`](../../apps/api/src/main-planner/destinations.mock.ts) (22개 국내 지역, 이모지 포함).

### 5-2. `POST /trips`

요청 DTO (`CreateTripRequestDto`):

```ts
interface CreateTripRequestDto {
  title: string;
  destination: string;
  startDate: string;   // "YYYY-MM-DD"
  startTime: string;   // "HH:mm"
  endDate: string;     // "YYYY-MM-DD"
  endTime: string;     // "HH:mm"
  members: PlannerMemberDto[];
  notes?: string;      // 선택, 자유 입력
}
```

mock 검증 (`BadRequestException`):
- `title` / `destination` 공백 금지
- `startDate` > `endDate` 금지
- `startTime` / `endTime` 누락 금지
- 같은 일자일 때 `startTime >= endTime` 금지

응답: 생성된 `TripSummaryDto`.
- `id`: `trip-<base36 timestamp>`
- `durationLabel`: `"1박 2일 · 5/21 목 09:00 ~ 5/22 금 18:00"` 형태 (`buildDurationLabel`)
- `status`: 시작일이 오늘 이후 30일 이내 → `upcoming`, 과거 → `done`, 그 외 → `draft`
- `coverEmoji`: 항상 `🧳`
- `highlight`: `notes?.trim() || '새로 생성된 여행 계획'`
- `hasDetail`: `false` — 상세 mock 이 없어 카드는 클릭 비활성

저장 위치: in-memory 배열 `TRIP_SUMMARIES_MOCK` 의 head 에 `unshift`. 프로세스 재시작 시 초기화.

## 6. 화면 컴포넌트 매핑

| 영역                       | 컴포넌트 / 위치                                                            |
| -------------------------- | -------------------------------------------------------------------------- |
| 헤더(뒤로 / 타이틀)        | `views/trip-create` 인라인                                                  |
| 여행 제목 입력             | 인라인 `<input>` (40자 제한)                                                |
| 여행 지역 자동완성          | `features/destination-search/DestinationSearchInput`                        |
| 여행 기간 카드(달력+시각)   | `react-day-picker` + `views/trip-create/ui/time-select.tsx`                 |
| 동행자 칩                   | `views/trip-create` 인라인 (`MEMBER_COLORS` 순환)                           |
| 메모 텍스트영역             | `views/trip-create` 인라인 `<textarea>` (200자, 카운터 + 안내문)            |
| 액션바(모바일 / 데스크탑)   | `views/trip-create` 인라인 `Button` (`disabled = !canSubmit || isPending`)  |
| `/trips` 진입 동선          | `views/trips` 헤더 + 빈 상태 CTA → `<Link href="/trips/new">`              |

## 7. 사용자 플로우

1. `/trips` 진입 → 헤더의 `새 여행` (모바일) 또는 `새 여행 만들기` (데스크탑) 클릭 → `/trips/new`.
2. 제목 입력 → 지역 자동완성에서 후보 선택(또는 직접 입력) → 달력 range 두 번 클릭으로 기간 지정 → 출발/도착 시각 선택 → 동행자 칩 추가 → 선택적으로 메모 작성.
3. CTA 활성 조건: 제목·지역·시작/종료일이 모두 있고, 같은 일자라면 시각 순서가 올바를 때.
4. CTA 클릭 → `createTrip()` → 성공 시 `queryClient.invalidateQueries(queryKeys.planner.trips)` → `/trips` 로 라우팅.
5. 목록 카드에 신규 trip 이 즉시 노출되고, `highlight` 에 메모 일부가 보인다. (상세 진입은 비활성)

mock 한정 동작:
- 새로고침/재기동 시 목록에서 사라진다 (in-memory 한계).
- 카드 클릭은 막혀 있다 (상세 mock 없음).

## 8. 검증

```bash
pnpm --filter @tripick/types build
pnpm --filter @tripick/api typecheck
pnpm --filter @tripick/web typecheck
```

수동 검증 절차:
1. `pnpm --filter @tripick/api dev` (4000) + `pnpm --filter @tripick/web dev` (3000)
2. `/trips` → `새 여행` 버튼 클릭 → `/trips/new` 진입
3. 지역 입력 `해` 입력 시 "해운대" 노출 확인
4. 달력 range 두 번 클릭으로 기간 선택, 요약 라벨(예: "1박 2일") 확인
5. 시각 드롭다운 열림 → 현재값으로 자동 스크롤 확인, 다른 시각 선택 반영 확인
6. 동행자 이니셜 입력 → 엔터 / + 버튼 → 칩 추가, × 로 제거 (`나` 칩은 제거 불가)
7. 메모 200자 초과 입력 시 잘림 + 카운터 갱신
8. CTA → `/trips` 라우팅, 신규 카드가 목록 최상단에 추가됨 확인
9. 같은 일자 + `endTime <= startTime` 케이스 → 인라인 에러 메시지 노출 및 CTA 비활성

## 9. 후속 작업 (backlog)

- 생성된 trip 의 상세 mock 자동 시드(또는 일정 생성 워크플로) → `/planner?tripId=…` 진입 가능화
- 한국관광공사 / 카카오 로컬 API 연동으로 `/destinations` 교체 (mock → 실연동)
- 멤버 입력을 카카오 친구 검색 / 초대 링크로 확장
- `notes` 를 LLM 프롬프트 컨텍스트로 전달 (Constraint Engine 의 자유 입력 처리)
- DB 영속화 + Auth guard 부착 (현재는 in-memory + 가드 없음)

## 10. 결정 요약

1. 신규 여행 생성은 한 화면 폼으로 완결한다. 단계형 마법사 미도입.
2. UI 토큰은 main-planner v1 과 동일한 toss-v1 만 사용한다.
3. 달력은 react-day-picker v10 의 `mode="range"` + 토스 톤 CSS 오버라이드.
4. 시각 입력은 브라우저 default 대신 자체 드롭다운(`TimeSelect`) 으로 통일된 톤을 유지한다.
5. 메모는 선택 입력. 비어 있으면 payload 에서 제거, 채워지면 mock summary 의 `highlight` 로 노출.
6. mock 백엔드는 in-memory append 만 수행하고, 한계는 명시한다. 영속화는 후속.

---

## 11. v1.1 확장 (2026-07): 플래너 옵션 · MUI 시계 피커 · 로딩 화면

기준 브랜치: `feat/trip-create-planner-options` (base: `develop`)
관련 커밋: `19516ec` (플래너 옵션·MUI 피커·CTA) → `4fcff1f` (폼 버그 수정) → `4d6dc1d` (로딩 화면)

### 11-1. 배경 / 범위

v1 폼은 제목·지역·기간·시각·동행자·메모만 받았다. AI 일정 품질을 높이려면 생성 시점에 **취향/제약 정보를 구조화**해 받을 필요가 있어, 재계획 모달(`features/request-replan`)에서 이미 검증된 옵션(꼭 포함할 장소·일정 강도·예산)을 생성 폼으로 끌어오고 이동 수단을 추가했다. 더불어 시각 입력을 라이브러리 기반(MUI)으로 교체하고, 생성 대기 UX·폼 검증 결함을 함께 정리했다.

포함:
- 생성 폼 신규 입력: 꼭 포함할 장소 · 일정 강도 · 예산 · 이동 수단
- 시각 입력을 자체 `TimeSelect` → **MUI `TimePicker`(아날로그 `TimeClock` 팝업)** 로 교체
- 재계획 모달의 장소 피커를 `shared/ui/PlaceSearchPicker` 로 공용화
- 데스크탑 하단 CTA 추가, 모바일 sticky CTA 가려짐 수정
- 폼 버그 수정(당일치기 시각 검증·과거 날짜 차단·세그먼트 3열·이동수단 해제)
- 여행 생성 중 풀스크린 로딩 화면

### 11-2. 추가 입력 필드

| 필드            | UI 컴포넌트                          | payload 키          | 값                              | BE 처리                              |
| --------------- | ------------------------------------ | ------------------- | ------------------------------- | ------------------------------------ |
| 꼭 포함할 장소  | `shared/ui/PlaceSearchPicker`        | `mustIncludePlaces` | `ReplanPlaceDto[]` (카카오 검색) | notes 로 합성 ("꼭 포함할 장소: …")  |
| 일정 강도       | `SegmentToggle columns={3}`          | `pace`              | `relaxed \| balanced \| packed` | notes 로 합성 ("일정 강도: …")       |
| 예산            | `SegmentToggle columns={3}`          | `budget`            | `thrifty \| normal \| premium`  | notes 로 합성 ("예산: …")            |
| 이동 수단       | `SegmentToggle` (2열, 재클릭 해제)   | `transportMode`     | `transit \| car` (선택)          | trip 컬럼 저장 (미선택 시 취향 폴백) |

- `pace` 기본 `balanced`, `budget` 기본 `normal`, `transportMode` 기본 미선택(`''`).
- `mustIncludePlaces` / `transportMode` 는 값이 있을 때만 payload 에 포함.

### 11-3. 공유 타입 · BE 변경

`CreateTripRequestDto` 확장 ([`packages/types/src/main-planner.ts`](../../packages/types/src/main-planner.ts)) — 재계획 타입 재사용:

```ts
interface CreateTripRequestDto {
  // …기존 필드
  mustIncludePlaces?: ReplanPlaceDto[]; // from './replanning'
  pace?: ReplanPace;
  budget?: ReplanBudget;
  transportMode?: 'transit' | 'car';
}
```

BE 검증 DTO ([`main-planner.dto.ts`](../../apps/api/src/main-planner/dto/main-planner.dto.ts)):
- `forbidNonWhitelisted: true` 라 새 필드를 반드시 whitelist 에 추가해야 함 (누락 시 400).
- `mustIncludePlaces` 는 재계획의 `ReplanPlaceBodyDto` 를 재사용해 `@ValidateNested`.
- `pace` / `budget` / `transportMode` 는 `@IsIn` 화이트리스트.

BE 서비스 ([`main-planner.service.ts`](../../apps/api/src/main-planner/main-planner.service.ts) `createTrip`):
- trip 엔티티에 `pace`/`budget`/`mustIncludePlaces` 전용 컬럼이 없어, `composeCreateTripNotes()` 로 사용자 `notes` 뒤에 한 줄 요약(`일정 강도: 균형 · 예산: 보통 · 이동 수단: 대중교통 · 꼭 포함할 장소: A, B`)을 이어 붙여 AI 프롬프트로 전달.
- `transportMode` 는 `dto.transportMode ?? resolveTransportMode(preference)` 로 컬럼 저장 (폼 선택이 취향 기본값보다 우선).

### 11-4. 시각 입력 교체 (MUI)

- 제거: `react-time-picker` 검토안 → 자체 `TimeSelect` → 최종 **`@mui/x-date-pickers`(v9) `TimePicker`**.
- `viewRenderers` 에 `renderTimeViewClock` 지정 → 클릭 시 **별도 팝업의 아날로그 시계**로 시·분 선택.
- 어댑터 `AdapterDateFns`(설치돼 있던 date-fns v4 호환), 로케일 `ko`, 24시간제(`ampm={false}`).
- 값은 기존과 동일하게 `"HH:mm"` 문자열 in/out (Date ↔ string 변환은 컴포넌트 내부).
- 스타일: 페이지 폰트(`fontFamily: 'inherit'`)·토스 톤(높이 48px·`rounded-[14px]`·`#E5E8EB`·포커스 `#3182F6`+`#E1ECFF` 링) `slotProps.textField.sx` 로 매핑, 팝업 선택색은 `ThemeProvider` primary `#3182F6`.
- `react-clock` 은 pnpm strict 구조상 web 직접 의존성으로 추가 필요.

### 11-5. PlaceSearchPicker 공용화

- 재계획 모달 내부 `MustIncludePicker` 를 [`shared/ui/place-search-picker.tsx`](../../apps/web/src/shared/ui/place-search-picker.tsx) 로 추출 (카카오 로컬 검색 → 칩 담기).
- `replan-modal` 과 `trip-create-view` 가 동일 컴포넌트 사용 → 중복 제거.
- `shared/ui → shared/lib`(useKakaoPlaceSearch) 참조는 단방향이라 FSD 위반 없음.

### 11-6. 레이아웃 · CTA

- 데스크탑: 헤더 우측 CTA 유지 + **폼 카드 하단에 안내문+`여행 만들기` 버튼 행** 추가.
- 모바일 sticky CTA: 하단 탭(높이 `pt-1.5 6px + grid 66px + safe-area pb`)에 가려지던 문제 수정 → `bottom-[calc(72px+max(10px,env(safe-area-inset-bottom)))]`, 본문 `pb-[184px]`.

### 11-7. 버그 수정

| 항목                | 문제                                                                      | 수정                                                        |
| ------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 당일치기 시각 검증  | `sameDay` 가 `range.to` 를 요구 → 1클릭 당일치기는 출발>도착이 FE 미검증(BE 400) | `sameDay = startDate === endDate` 로 판정                    |
| 과거 날짜 선택      | `DayPicker` 에 제약 없어 지난 날짜 선택 가능                               | `disabled={{ before: today }}` + `startMonth={today}`       |
| 3-옵션 세그먼트     | `SegmentToggle` grid-cols-2 고정 → 3개 옵션이 2+1 로 깨짐                  | `columns?: 2 \| 3` prop 추가, 강도·예산에 `columns={3}`      |
| 이동 수단 해제 불가 | 한 번 고르면 미선택으로 못 돌아감                                          | 같은 값 재클릭 시 `''` 로 토글                              |

### 11-8. 로딩 화면

- [`trip-create-loading.tsx`](../../apps/web/src/views/trip-create/ui/trip-create-loading.tsx): `fixed inset-0 z-50` 풀스크린. 스피너(회전 링 + `LuPlane`) + 2.2초 순환 안내 문구, `role="status"`/`aria-live`.
- 표시 조건 `showLoading = isPending || navigating`. 생성 성공 시 `navigating=true` 로 두어 `/planner` 이동 완료까지 유지(→ `isPending` 하강 시 깜빡임 방지). 에러 시엔 로딩이 사라지고 기존 인라인 에러 노출.

### 11-9. FSD 구조 변경분

```
apps/web/src/
├── shared/ui/
│   ├── place-search-picker.tsx        # (신규) 카카오 검색 장소 피커 (재계획·생성 공용)
│   └── segment-toggle.tsx             # columns prop 추가
├── views/trip-create/ui/
│   ├── time-field.tsx                 # (신규) MUI TimePicker 래퍼
│   ├── trip-create-loading.tsx        # (신규) 생성 중 풀스크린 로딩
│   └── time-select.tsx                # (삭제) 자체 드롭다운 → MUI 로 대체
└── features/request-replan/ui/replan-modal.tsx  # MustIncludePicker → PlaceSearchPicker
```

### 11-10. 검증

```bash
pnpm --filter @tripick/types build
pnpm --filter @tripick/api typecheck   # BE DTO/서비스
pnpm --filter @tripick/web typecheck
pnpm --filter @tripick/web build       # MUI SSR/모듈 해석·CSS 확인
```

### 11-11. 결정 요약 (v1.1)

1. 생성 시점 취향/제약을 재계획 옵션과 **동일 타입(`ReplanPace`/`ReplanBudget`/`ReplanPlaceDto`)** 으로 통일해 재사용.
2. `pace`/`budget`/`mustIncludePlaces` 는 DB 스키마 변경 없이 `notes` 합성으로 전달(빠른 반영), `transportMode` 만 기존 컬럼 사용. 전용 컬럼·일정 생성 파이프라인 반영은 후속.
3. 시각 입력은 자체 구현 대신 MUI `TimePicker` + 아날로그 `TimeClock` 채택, 토스 톤은 sx/테마로 매핑.
4. 장소 피커는 `shared/ui` 로 승격해 재계획·생성 공용. (v1 의 "재사용 수요 발생 시 승격" 방침 적용)
5. 생성 대기는 버튼 문구가 아닌 전용 풀스크린 로딩으로 승격, 이동 완료까지 유지.
