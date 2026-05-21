# TriPick 새 여행 만들기 v1

문서 목적: `/trips/new` 경로의 신규 여행 생성 플로우(웹 전용, mock 백엔드)가 기존 main-planner v1 구조 위에 어떻게 얹혔는지를 고정한다. 디자인 토큰·FSD 레이어·mock API 명세·필드 정의를 모아둔다.

기준 브랜치: `feat/add-trip`
선행 문서: [`docs/main-planner-v1.md`](./main-planner-v1.md) (Screen 3·4·내 여행 목록)
기준 디자인 시스템: [`docs/design-system/toss-v1.md`](./design-system/toss-v1.md)

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

달력 톤(react-day-picker) 오버라이드: [`apps/web/src/views/trip-create/ui/trip-create-calendar.css`](../apps/web/src/views/trip-create/ui/trip-create-calendar.css)
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
모듈: [`apps/api/src/main-planner/`](../apps/api/src/main-planner)

| Method | Path                          | 응답                          |
| ------ | ----------------------------- | ----------------------------- |
| GET    | `/destinations?q=…`           | `DestinationSuggestionDto[]`  |
| POST   | `/trips` (body 아래)          | `TripSummaryDto`              |

### 5-1. `GET /destinations`

- `q` 가 비어 있으면 상위 8개 기본 노출.
- `name` / `region` 부분일치 (대소문자 무시), 최대 10개 반환.
- fixture: [`apps/api/src/main-planner/destinations.mock.ts`](../apps/api/src/main-planner/destinations.mock.ts) (22개 국내 지역, 이모지 포함).

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
