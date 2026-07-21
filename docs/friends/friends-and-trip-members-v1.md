# TriPick 친구 · 여행 멤버 · 조율 재배치 v1

문서 목적: top-level 로 떠 있던 `/members` · `/coordination` 을 trip 컨텍스트 하위로 옮기고, 사용자 단위의 친구 관계를 새로 도입한 작업을 고정한다. main-planner v1 · trip-create v1 위에 얹는 변경이며 디자인 시스템 · FSD · mock API · 화면 매핑 규칙은 동일한 흐름으로 정리한다.

기준 브랜치: `feat/friends-and-trip-members`
선행 문서:
- [`docs/planner/main-planner-v1.md`](../planner/main-planner-v1.md) (Screen 3·4·내 여행 목록)
- [`docs/trips/trip-create-v1.md`](../trips/trip-create-v1.md) (`/trips/new` 신규 여행 생성)

기준 디자인 시스템: [`docs/design-system/toss-v1.md`](../design-system/toss-v1.md)

## 1. 배경 / 문제

v1 초안에서는 `/members` 와 `/coordination` 이 `/trips` · `/planner` 와 같은 top-level 라우트로 존재했다.

| 라우트         | 실제 데이터 스코프 | 위치 위화감                                                  |
| -------------- | ------------------ | ------------------------------------------------------------ |
| `/members`     | trip 별 멤버       | 어떤 여행의 멤버인지 라우트만으로는 불명. 활성 trip 추정 필요 |
| `/coordination`| trip 별 멤버 취향  | 동일. 여행이 여러 개면 어느 여행 조율인지 모호                |

해결 방향:
- 트립 스코프 데이터(여행 멤버 · 취향 조율) → **여행 상세(`/planner`) 하위로 이동**
- 사용자 스코프(여행에 무관한 사람 관리) → **새로운 `/friends` (카카오톡 친구 톤)** 으로 분리
- 두 화면은 "친구 등록 → 여행 멤버로 추가" 흐름으로 연결

## 2. 범위

포함:
- 신규 라우트 `/friends` (카카오톡 친구 목록 톤) — 받은 요청 / 즐겨찾기 / 친구 섹션, 검색, 핸들로 친구 요청, 핀 / 삭제 액션
- 플래너 헤더(`PlannerHeader`) 멤버 아바타 클릭 → `TripMembersSheet` (현재 멤버 + 친구 목록에서 추가/제거)
- 신규 여행 생성 폼 동행자 입력을 친구 목록 선택 드롭다운(`FriendMemberPicker`) 으로 교체
- 플래너 4번째 탭 `조율` + 신규 `TripCoordinationPanel` 위젯 (트립 스코프 취향 조율)
- mock backend: 친구 CRUD(`/api/v1/friends`) + 트립 멤버 add/remove + 트립 조율 fetch
- `BottomSheet` lg+ 데스크탑 모달 모드 (가운데 정렬 + 페이드/스케일)
- `FriendMemberPicker` 뷰포트 인식 드롭다운(아래/위 자동 뒤집기 + 동적 max-height)
- 하단 4탭 → 3탭 (홈 / 취향 / 친구)

제외 / 후속:
- 친구 추가 후 trip 조율 fixture 동적 재계산 (mock 한정 정적 fixture)
- 친구 요청 알림 / 받은 요청 채널 (수락은 즉시 mock 처리)
- 인증 연동 (mock 컨트롤러는 가드 없음, 단일 사용자 가정)

## 3. UX 결정 요약

- "친구" 와 "여행 멤버" 를 별도 개념으로 분리한다. 멤버는 trip 안의 친구 reference 형태.
- 친구 등록과 여행 멤버 관리는 다른 화면에 둔다 (책임 분리). 단, 트립 멤버 시트 안에서도 친구 목록을 직접 검색·추가할 수 있어 두 흐름을 매끄럽게 잇는다.
- 멤버 시트 진입은 `PlannerHeader` 의 멤버 아바타 묶음을 버튼화. 별도 메뉴/링크를 추가하지 않는다 (Figma 의 아바타 묶음 패턴을 그대로 사용).
- 조율 탭은 일정/지도/정보와 동일 계층(planner 탭) 으로 둔다. 별도 라우트 진입을 강요하지 않는다.
- 데스크탑(2xl+) 에서는 우측 정보 패널 아래에 조율 패널을 같이 노출해 한눈에 정보를 확인.
- `BottomSheet` 는 모바일에서는 슬라이드 업, 데스크탑(lg+) 에서는 중앙 모달처럼 동작 — 두 시트(`AlternativeSheet` · `TripMembersSheet`) 모두 자동 적용.

## 4. 디자인 시스템 적용 매핑

main-planner v1 · trip-create v1 과 동일한 toss-v1 토큰만 사용한다. 신규 화면의 매핑은 다음과 같다.

| 토큰                      | 사용 위치                                                                 |
| ------------------------- | ------------------------------------------------------------------------- |
| `background #F7F8FA`      | `/friends` 캔버스, 멤버 시트 보조 영역                                    |
| `surface #FFFFFF`         | 친구 카드, 시트 본문, 조율 패널 카드                                       |
| `surface-muted #FAFBFC`   | 친구 섹션 헤더 줄, 빈 상태 안내                                            |
| `primary #3182F6`         | 친구 추가 CTA, 핀(★ hover), 트립 멤버 추가 버튼, 조율 진행 바              |
| `primary-pressed #1B64DA` | CTA hover, 조율 추천 카드 라벨                                             |
| `success #00A86B`         | (조율 추천 보조 — 향후 추가될 합의 강도 표시 위치 예약)                     |
| `warning #FF8A00`         | 친구 핀(★) 활성, 즐겨찾기 표시                                             |
| `error #F04452`           | 친구 삭제 hover, mutation 에러 박스                                        |
| `divider #E5E8EB`         | 모든 카드/시트 border, 친구 섹션 분리선                                    |
| `chip background #EAF2FF` | `FriendMemberPicker` 선택 친구 row, `coordination` 추천 카드 배경          |

추가 비주얼 규칙:
- 친구 아바타는 `FriendAvatar` (size sm/md/lg). 이모지가 있으면 우선, 없으면 이니셜 흰색 글자.
- 트립 멤버 시트의 "기본 멤버" 칩은 `bg-#F2F4F6 + text-#6B7684` 로 톤 다운.
- 조율 추천 카드만 강조용 `#EAF2FF / border-#BFD7FF / text-#1B64DA` 사용 → 다른 카드와 시각 분리.

## 5. FSD 디렉터리 구조 (이 작업 추가/이동/제거 분)

```
apps/web/src/
├── app/
│   ├── friends/page.tsx                            # 신규 (구 /members 대체)
│   └── planner/page.tsx                            # 4번째 탭 조율 + 멤버 시트 연결
│
├── views/
│   └── friends/ui/friends-view.tsx                 # 카카오톡 친구 톤 메인 화면
│
├── widgets/
│   └── trip-coordination-panel/                    # 트립 별 조율 결과 카드 3섹션
│
├── features/
│   └── manage-trip-members/                        # 플래너 헤더에서 열리는 멤버 시트
│
├── entities/
│   ├── friend/                                     # 신규: API + FriendAvatar/FriendRow
│   │   ├── api.ts
│   │   ├── index.ts
│   │   └── ui/{friend-avatar,friend-row}.tsx
│   └── trip-plan/                                  # API 확장: 트립 멤버 add/remove + 조율 fetch
│
├── shared/
│   ├── api/query-keys.ts                           # + friends.list, planner.members/coordination
│   └── ui/
│       ├── app-frame.tsx                           # 네비 멤버→친구, 조율 제거 (3탭화)
│       └── bottom-sheet.tsx                        # lg+ 모달 모드
│
└── (제거)
    ├── app/members/                                # → /friends 로 대체
    ├── views/members/                              # 구 trip-member manager
    ├── features/member-management/                 # 구 멤버 입력 UI
    ├── app/coordination/                           # 구 top-level 조율
    ├── views/coordination/
    └── features/preference-coordination/           # 구 JWT-backed 조율 보드
```

규칙 (선행 문서와 동일):
- import 방향: `entities` → `features` → `widgets` → `views` → `app`
- 라우트 단위 화면 조립은 `views/<route>/ui/<route>-view.tsx`. 컴포넌트명 `*View`.
- `FriendMemberPicker` 는 `/trips/new` 전용이라 colocate (`views/trip-create/ui/`). 다른 화면에서 재사용 수요가 생기면 `features/select-trip-member` 로 승격.
- `TripMembersSheet` 는 플래너 헤더 트리거 + 트립 컨텍스트에 묶이므로 feature 계층.
- `TripCoordinationPanel` 은 트립 데이터 의존(`tripId`) 하지만 도메인 hook 없이 fetch + 렌더만 → widget 계층.

## 6. mock API 명세

### 6-1. 친구 모듈 (신규)

base URL: `http://localhost:4000/api/v1/friends`
모듈: [`apps/api/src/friends/`](../../apps/api/src/friends)

| Method | Path             | 응답          | 비고                                  |
| ------ | ---------------- | ------------- | ------------------------------------- |
| GET    | `/`              | `FriendDto[]` | 전체 친구 (incoming 요청 포함)        |
| POST   | `/`              | `FriendDto`   | body `{ handle }` → status=`pending`  |
| PATCH  | `/:id/accept`    | `FriendDto`   | 받은 요청 수락 (status=`accepted`)    |
| PATCH  | `/:id/pin`       | `FriendDto`   | 즐겨찾기 토글                          |
| DELETE | `/:id`           | 204           | 친구 삭제                              |

DTO ([`packages/types/src/friend.ts`](../../packages/types/src/friend.ts)):

```ts
type FriendStatus = 'accepted' | 'pending' | 'incoming';
interface FriendDto {
  id: string;
  nickname: string;
  handle: string;            // 예: "@koty"
  color: string;             // #hex
  initial: string;
  emoji?: string;
  statusMessage?: string;
  status: FriendStatus;
  pinned: boolean;
  createdAt: string;
}
interface AddFriendRequestDto { handle: string }
```

fixture: [`apps/api/src/friends/friends.mock.ts`](../../apps/api/src/friends/friends.mock.ts)
- 기본 7명 (accepted 6 + incoming 1: `@yoon.sa`)
- `addFriendMock(handle)` 은 status=`pending` 으로 push, `acceptFriendMock` 으로 `accepted` 전환
- 색상은 handle 해시 기반 7색 팔레트에서 결정

### 6-2. 트립 멤버 (`main-planner` 확장)

| Method | Path                                                | 응답                 |
| ------ | --------------------------------------------------- | -------------------- |
| POST   | `/main-planner/trips/:tripId/members`               | `PlannerMemberDto[]` |
| DELETE | `/main-planner/trips/:tripId/members/:memberId`     | `PlannerMemberDto[]` |

요청 (`POST`):

```ts
interface AddTripMemberRequestDto { friendId: string }
```

동작:
- 친구 id → 트립 멤버 id 매핑: `` `tm-${friendId}` ``
- 이미 있는 멤버면 `ConflictException`
- 멤버 컬러/이니셜은 친구 정보 그대로 복사
- in-memory 상태이므로 프로세스 재시작 시 초기화

### 6-3. 트립 조율 (`main-planner` 확장)

| Method | Path                                          | 응답                       |
| ------ | --------------------------------------------- | -------------------------- |
| GET    | `/main-planner/trips/:tripId/coordination`    | `PlannerCoordinationDto`   |

DTO 추가 ([`packages/types/src/main-planner.ts`](../../packages/types/src/main-planner.ts)):

```ts
interface PlannerCoordinationMemberDto {
  id: string;
  initial: string;
  color: string;
  tasteLabels: string[];     // 예: ["한식·전통", "감성 코스"]
}
interface PlannerCoordinationVoteRowDto {
  key: string;
  label: string;
  count: number;
  voters: string[];          // 멤버 이니셜
}
interface PlannerCoordinationDto {
  tripId: string;
  members: PlannerCoordinationMemberDto[];
  consensus: { food: PlannerCoordinationVoteRowDto[]; mood: ...; environment: ... };
  recommendation: { title; summary; reasons: string[]; scheduleHint };
}
```

fixture: [`apps/api/src/main-planner/main-planner-coordination.mock.ts`](../../apps/api/src/main-planner/main-planner-coordination.mock.ts)
- 경주 trip 기본 3명(태/박/홍) 기준 식사 · 관광 · 환경 컨센서스 + AI 추천 1건
- mock 한정: 트립 시트로 친구를 새로 추가해도 voters 에 자동 합류하지 않음 (정적 fixture, backlog)

## 7. 화면 컴포넌트 매핑

### 7-1. `/friends` 친구 목록

| 영역                       | 컴포넌트                                                       |
| -------------------------- | -------------------------------------------------------------- |
| 모바일 헤더 / 데스크탑 헤더 | `views/friends` 인라인                                          |
| 검색 입력 + 친구 추가 카드  | 인라인 (handle 입력 → `addFriend` mutation)                    |
| 받은 요청 섹션              | 조건부 (incoming 있을 때만) — 수락/거절 액션                    |
| 즐겨찾기 / 친구 섹션        | 공통 `FriendRow` + `FriendRowMenu` (★ 핀 토글, × 삭제)         |
| 에러/빈 상태                | 인라인 박스 (`#FFECEE` 에러, `#FAFBFC` 빈 상태 안내)            |
| 하단 네비                    | `widgets/planner-bottom-nav` (active=`friends`)                |

### 7-2. 플래너 멤버 시트

| 영역                     | 컴포넌트                                                                  |
| ------------------------ | ------------------------------------------------------------------------- |
| 트리거                    | `widgets/planner-header` (모바일) + 데스크탑 헤더 인라인 — 둘 다 멤버 아바타 묶음을 버튼화 |
| 시트 컨테이너             | `shared/ui/BottomSheet` (lg+ 모달, 모바일 슬라이드 업)                   |
| 트립 헤더 (제목 + 안내)    | `features/manage-trip-members` 인라인                                     |
| 현재 멤버 리스트          | `FriendAvatar` + 본 여행 기본 멤버 칩 + `제외` 버튼                       |
| 친구 검색 + 후보 리스트    | 인라인 검색 + 친구 row (이미 추가된 친구는 자동 필터)                     |

추가 동작:
- `PlannerHeader` 에 `onMembersClick?: () => void` 옵션 추가 → 제공되면 아바타 묶음이 버튼이 되고 hover bg + ＋ 아이콘
- `views/planner` 가 `membersOpen` 상태를 관리. 시트 mutation 성공 시 `queryKeys.planner.trip(tripId)` invalidate → 헤더 아바타 즉시 갱신

### 7-3. `/trips/new` 동행자 입력 교체

| 영역                  | 컴포넌트                                                              |
| --------------------- | --------------------------------------------------------------------- |
| 선택된 멤버 칩         | `views/trip-create/ui/friend-member-picker.tsx` 인라인                |
| `＋ 친구 추가` 버튼    | 동일 컴포넌트 트리거 (토글식)                                          |
| 드롭다운 패널          | `position: absolute` + 트리거 측정 기반 위/아래 뒤집기 + 동적 maxHeight |
| 친구 검색              | 인라인 input + `accepted` 필터                                         |
| 친구 row               | `FriendAvatar` + 체크박스(✓) 토글 (선택/해제)                          |

`memberId` 규약: `f-${friendId}` (트립 생성 폼 내부 한정. 생성 후 mock summary 의 members 배열에 그대로 저장)

### 7-4. 트립 조율 패널 (4번째 탭)

| 섹션                | 표현                                                              |
| ------------------- | ----------------------------------------------------------------- |
| 멤버별 취향          | `FriendAvatar` 대신 색상 dot + 이니셜 + 태그 칩 묶음                |
| 취향 비교            | 식사 / 관광 / 환경 — 진행 바 (top vote 라벨 + voters 이니셜 목록) |
| AI 절충 추천         | `#EAF2FF` 카드 — 제목 + 요약 + reasons(•) + scheduleHint 푸터       |
| 로딩                  | 3단 skeleton (`animate-pulse` + `#F2F4F6` 배경)                    |

데스크탑 노출: 2xl+ 우측 패널에 `TripInfoPanel` 아래로 `TripCoordinationPanel` 을 같이 렌더 (모바일은 탭 진입).

### 7-5. BottomSheet (lg+ 모달 모드)

- `matchMedia('(min-width: 1024px)')` 로 데스크탑 감지 + resize 대응
- 모바일: 기존 슬라이드 업 (translateY 100% → 0), 상단만 둥글기, drag handle 노출, `max-w-[480px]`
- 데스크탑: opacity 0 → 1 + scale(0.96 → 1) 페이드 인, 전체 둥글기, drag handle 숨김, `max-w-[560px]` 중앙 정렬, 컨테이너 padding 24
- 외곽 클릭 닫기: wrapper `onClick` 에서 `event.target === event.currentTarget` 검사 → backdrop 버튼 단독 분리 없이도 카드 외부 클릭 시 닫힘
- 본문 영역 `min-h-0 flex-1` + `max-h-[70vh]`(lg에서 `max-h-[78vh]`) → 컨테이너 안에서 안전하게 스크롤

### 7-6. `FriendMemberPicker` 뷰포트 인식

- 트리거 `getBoundingClientRect()` 측정 → 아래 공간 ≥ 220px 또는 아래 > 위면 down, 아니면 up
- `maxHeight` 동적 계산 (min 220 / max 360, 뷰포트 16px 여백)
- `resize` + 캡쳐 단계 `scroll` 모두 재측정 — 폼이 길어 스크롤 위치가 바뀌어도 적응
- z-index 30 — `/trips/new` 모바일 액션바(z-10) 위로 확실히 노출

## 8. 사용자 플로우

1. `/friends` 진입 → handle 입력으로 친구 요청 (pending) / 받은 요청 수락 / 즐겨찾기 핀.
2. `/planner` 진입 → 헤더의 멤버 아바타 클릭 → 시트 오픈.
3. 시트에서 친구 검색 → 선택 → `POST /main-planner/trips/:tripId/members` → 응답으로 멤버 배열 업데이트 → trip 쿼리 invalidate → 헤더 아바타 즉시 갱신.
4. 멤버 제외도 동일 패턴 (`DELETE`).
5. 같은 trip 화면 안에서 `조율` 탭 → `GET /main-planner/trips/:tripId/coordination` → 컨센서스 + AI 추천 카드.
6. `/trips/new` 폼에서는 친구 목록 드롭다운으로 동행자 선택 → trip 생성 시 그대로 `members` 에 직렬화.

mock 한정 동작:
- 새로 추가한 멤버는 trip 의 `members` 배열에만 들어가고, 조율 fixture (`PLANNER_COORDINATION_MOCK`) 의 voters 는 그대로다.
- 친구 요청은 자동 수락되지 않음 (`pending`). 받은 요청(`incoming`) 에서 `수락` 시만 `accepted`.

## 9. 검증

```bash
pnpm --filter @tripick/types build
pnpm --filter @tripick/api typecheck
pnpm --filter @tripick/web typecheck
```

세 명령 모두 통과해야 한다.

수동 검증 절차:
1. `pnpm --filter @tripick/api dev` (4000) + `pnpm --filter @tripick/web dev` (3000)
2. `/friends` 진입 → "받은 요청" 섹션의 `@yoon.sa` 수락/거절, 새 handle (`example`) 입력으로 친구 요청 추가 → `pending` 으로 노출
3. `/friends` 친구 row 의 ★ 토글로 즐겨찾기 섹션 이동 확인
4. `/planner` 진입 → 모바일 헤더 아바타 묶음 클릭 → 시트가 슬라이드 업
5. 시트에서 친구 검색 + 추가 → 헤더 아바타 즉시 반영 / `제외` 로 제거 동일 확인
6. 데스크탑(≥1024px) `/planner` → 헤더 우측 아바타 묶음 클릭 → 중앙 모달 페이드/스케일 인 → 카드 외곽 클릭 시 닫힘
7. `/planner` 모바일 4번째 탭 `조율` → 일자 셀렉터 숨김 + 멤버 취향 / 비교 / AI 추천 3섹션 노출
8. `/planner` 2xl+ 우측 패널 — 정보 + 조율이 세로 나열되어 같이 보임
9. `/trips/new` 폼 → 동행자 `＋ 친구 추가` → 드롭다운에서 친구 선택 → 칩 추가, ✓ 다시 누르면 해제
10. 폼 하단에서 `＋ 친구 추가` 열기 → 드롭다운이 위쪽으로 뒤집어 열림 + 잘림 없음

## 10. 후속 작업 (backlog)

- 시트로 새로 추가된 멤버를 조율 fixture 의 voters 에 동적으로 합류시키는 로직 (mock 일관성)
- 친구 요청 알림 채널 (FCM mock or in-app toast)
- 친구 등록 시 카카오 친구 API 연동 (현재는 handle 입력만)
- 트립 멤버 시트에서 친구 외 비회원 멤버 직접 추가 (이메일/카카오 ID 초대)
- 조율 패널의 `recommendation` 을 실 일정과 연결 (예: "오전 유적지" 카드 → 실제 itinerary item highlight)
- `FriendMemberPicker` 의 floating 로직을 라이브러리(`@floating-ui/react`) 로 추출해 다른 picker 와 공유

## 11. 결정 요약

1. trip 스코프 데이터(`members`, `coordination`)는 trip 상세(`/planner`) 하위로만 노출하고 top-level 라우트에서 제거.
2. 사용자 스코프(친구) 는 `/friends` 로 새로 분리. 두 화면은 친구 등록 → 트립 멤버 추가 흐름으로 연결.
3. 트립 멤버 관리 UI 는 `BottomSheet` (lg+ 모달) 로 노출하고, 별도 라우트를 추가하지 않는다.
4. 조율은 4번째 planner 탭 + 2xl+ 우측 패널 동시 노출. 별도 라우트 진입 없음.
5. `BottomSheet` 는 두 시트가 공유하는 primitive 이므로 모달 모드도 primitive 단위에서 처리 (소비처 무수정).
6. mock 한정 한계 (조율 fixture 정적 / 친구 추가가 voters 에 합류하지 않음) 는 backlog 로 명시.
