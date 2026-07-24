# TriPick 친구 페이지 개선 v1

문서 목적: 친구 페이지의 프로필 사진 표시, 친구 추가 정책·안내 정리, 그리고 친구 도메인을 여행 플로우와 잇는 두 기능(내 아이디 공유 · 친구와 여행 만들기)을 고정한다. [`friends-and-trip-members-v1`](friends-and-trip-members-v1.md) 위에 얹는 후속 개선으로, mock 이 아니라 실 백엔드(NestJS + TypeORM) 기준이다.

기준 브랜치: `feat/friends-page-enhancements`
작성일: 2026-07-24
선행 문서:
- [`docs/friends/friends-and-trip-members-v1.md`](friends-and-trip-members-v1.md) (친구 · 여행 멤버 · 조율 재배치)
- [`docs/trips/trip-create-v1.md`](../trips/trip-create-v1.md) (`/trips/new` 신규 여행 생성)
- [`docs/auth/email-login-and-session-v1.md`](../auth/email-login-and-session-v1.md) (세션 · 사용자 핸들)

## 1. 배경 / 문제

친구 페이지·여행 멤버 UI 가 실 데이터로 붙은 뒤 네 가지 문제가 드러났다.

| # | 문제 | 증상 |
| - | ---- | ---- |
| 1 | 친구·멤버 아바타가 항상 색상+이니셜 폴백만 노출 | 연결된 사용자의 프로필 사진(카카오)이 어느 레이어에도 전달되지 않음 |
| 2 | 친구 추가 안내 문구가 실제 동작과 불일치 | "친구 목록에 저장" 이라 즉시 추가처럼 읽히나, 실계정은 요청→수락 구조 |
| 3 | 미가입/오타 핸들이 조용히 친구로 저장 | 매칭 유저가 없으면 `accepted` 로 바로 등록("직접 등록한 여행 친구") |
| 4 | 친구 도메인이 여행 플로우와 단절 | 친구는 여행 멤버 후보일 뿐 접점이 없고, 상대가 나를 추가할 핸들 공유 수단도 없음 |

## 2. 범위

포함:
- 친구·여행 멤버·멤버 아바타 그룹 3곳에 연결 사용자 프로필 사진 배선 (`profileImageUrl`)
- 친구 추가 안내 문구 수정 + 친구 추가 카드를 검색창 위로 배치
- 미가입 핸들 친구 추가 거부 (`accepted` 즉시 저장 경로 제거)
- 친구 페이지 상단 "내 아이디 @handle · 복사" 공유 칩
- 수락된 친구 행에서 "여행 만들기" 바로가기(`/trips/new?friendId=`) + 생성 폼 동행자 pre-select

제외 / 후속:
- "함께한 친구와의 여행 N개" 집계 표시 — `FriendDto` 에 없는 조인/집계라 백엔드 확장 필요, 별도 작업
- 친구 상세 바텀시트(취향 태그 노출) — 취향 태그는 trip member 에만 있어 백엔드 확장 필요
- 내 아이디 QR 공유

## 3. 결정 · 근거

### 3.1 아바타 프로필 사진 (문제 1)

- **결정**: 친구/멤버는 실 사용자와 `friendUserId`/`userId` 로 연결돼 있고 `UserEntity.profileImageUrl` 이 소스다. 이 값을 **라이브 조인**으로 DTO 에 실어 내려 아바타에서 `<img>` 로 렌더, 로드 실패 시 색상+이니셜 폴백.
- **근거 — 스냅샷이 아니라 라이브 조인**: nickname/color/initial 은 추가 시점 스냅샷이지만 프로필 사진까지 스냅샷하면 (a) 기존 친구 row 에 사진이 없어 현 증상이 안 고쳐지고 (b) 사용자가 사진을 바꿔도 갱신되지 않는다. 조인이면 마이그레이션 없이 기존 row 까지 즉시 채워지고 최신 상태 유지.
- **배선 경로 (4 레이어)**:
  - `FriendDto` · `TripMemberDto` · `PlannerMemberDto` 에 `profileImageUrl?: string` 추가
  - `FriendsService`: `list`/`findOwned` 에 `friendUser` 조인, `toDto` 에서 `friendUser.profileImageUrl` 주입. `add` 는 저장 결과에 조회해둔 `friendUser` 를 붙여 즉시 반영
  - `TripMembersService`: `findAll` 에 `user` 조인, `toDto` 에 주입 → `MainPlannerService.toPlannerMember` 가 통과
  - web: `FriendAvatar` · `MemberAvatars`(→ `MemberAvatarItem` 분리) 가 URL 있으면 `<img>`, `onError` 시 폴백. `overflow-hidden` 원형 크롭, `referrerPolicy="no-referrer"`
- **주의**: `<img>` 는 코드베이스 관례(next/image 미사용)대로 `// eslint-disable-next-line @next/next/no-img-element` 를 붙인다. 외부 CDN 이라 next/image remotePatterns 설정 부담을 피함.
- **후보 친구 목록**(`TripMembersSheet` 추가 섹션 · `FriendMemberPicker`)은 `FriendDto` 전체를 넘겨 자동 반영. **현재 멤버 목록**만 `PlannerMemberDto` 경로라 별도 배선이 필요했다.

### 3.2 친구 추가 안내 · 배치 (문제 2)

- **결정**: 문구를 "상대방의 아이디(@)로 친구 요청을 보냅니다. 상대가 수락하면 친구가 돼요." 로 교체하고, 친구 추가 카드를 검색창 **위**로 이동.
- **근거**: 실계정 추가는 `pending`(요청) → 상대 `incoming` 수락 구조인데 기존 문구는 즉시 저장으로 오인시켰다. 추가가 이 페이지의 1차 행동이라 검색보다 위가 자연스럽다.

### 3.3 미가입 핸들 거부 (문제 3)

- **결정**: `FriendsService.add` 에서 매칭 유저가 없으면 `NotFoundException('존재하지 않는 아이디예요.')`. `accepted` 즉시 저장("직접 등록한 여행 친구") 경로 제거 → **모든 친구 추가는 `pending` 요청**으로 통일.
- **근거**: 오타·미가입 아이디가 조용히 친구 목록에 들어가고, 3.2 의 요청→수락 안내와도 어긋났다. 이제 정책이 문구와 일치.
- **정리**: 사용하지 않게 된 `nicknameFromHandle`, `FriendStatus` import 제거. self-add(400)·중복(409) 가드는 유저 조회 전에 동작하므로 영향 없음.

### 3.4 내 아이디 공유 칩 (문제 4)

- **결정**: 친구 페이지 최상단에 "내 아이디 @handle · 복사" 칩. 클립보드로 `@handle` 복사, 성공 시 `LuCheck` "복사됨" 1.5s 피드백.
- **근거**: 친구 추가가 상대 핸들을 알아야 가능한 구조라, 반대로 내 핸들을 알려줄 수단이 없어 상호 추가 마찰이 컸다.
- **세션 읽기**: `getStoredSession()` 은 localStorage 라 SSR 불일치 위험 → [`useHasSession`](../../apps/web/src/entities/session/lib/use-has-session.ts) 과 동일하게 `useSyncExternalStore`(서버 스냅샷 `null`, 마운트 후 실제 핸들)로 읽는다. `useEffect`+`setState` 는 `react-hooks/set-state-in-effect` 에 걸려 사용하지 않음.

### 3.5 친구와 여행 만들기 바로가기 (문제 4)

- **결정**: 수락된 친구 행(`FriendRowMenu`)에 여행 아이콘(`LuPlane`) 버튼 → `/trips/new?friendId=<id>`. 생성 폼이 `friendId` 쿼리를 받아 해당 친구를 동행자로 pre-select.
- **근거**: 친구는 곧 여행 멤버 후보인데 진입 동선이 없었다. 친구 → 여행 생성으로 바로 잇는 가장 가벼운 접점.
- **시드 방식**: 친구 데이터는 async 도착이라 초기값으로 못 넣는다. `useEffect`+`setState`(→ `set-state-in-effect` 위반) 대신, `trip-create-view` 가 이미 쓰는 **렌더 단계 상태 조정 패턴**(`prevSizingKey`)과 동일하게 데이터 도착 시 **1회만** 동행자로 시드. 사용자가 이후 제거해도 재시드하지 않는다.

## 4. 변경 파일

| 레이어 | 파일 | 변경 |
| ------ | ---- | ---- |
| types | `packages/types/src/friend.ts` | `FriendDto.profileImageUrl` |
| types | `packages/types/src/trip-member.ts` | `TripMemberDto.profileImageUrl` |
| types | `packages/types/src/main-planner.ts` | `PlannerMemberDto.profileImageUrl` |
| api | `apps/api/src/friends/friends.service.ts` | `friendUser` 조인·주입, 미가입 핸들 거부, 죽은 참조 정리 |
| api | `apps/api/src/trip-members/trip-members.service.ts` | `user` 조인·`profileImageUrl` 주입 |
| api | `apps/api/src/main-planner/main-planner.service.ts` | `toPlannerMember` 통과 |
| web | `apps/web/src/entities/friend/ui/friend-avatar.tsx` | `<img>` + onError 폴백 |
| web | `apps/web/src/entities/member/ui/member-avatar.tsx` | `MemberAvatarItem` 분리 + 사진 |
| web | `apps/web/src/features/manage-trip-members/ui/trip-members-sheet.tsx` | 현재 멤버 아바타에 URL 전달 |
| web | `apps/web/src/views/friends/ui/friends-view.tsx` | 안내 문구·배치, 내 아이디 칩, 여행 바로가기 |
| web | `apps/web/src/views/trip-create/ui/trip-create-view.tsx` | `initialFriendId` pre-select |
| web | `apps/web/src/app/trips/new/page.tsx` | `friendId` 쿼리 파싱 |
| test | `apps/api/test/friends/friends.e2e-spec.ts` | 미등록 핸들 케이스 → 등록 유저 기반 전환 |

## 5. 검증

- 친구 e2e (`apps/api/test/friends`): 10/10 통과. "미등록 핸들 → 404" 케이스로 교체, 친구 행을 만들던 케이스들을 등록 유저 기반으로 전환.
- `tsc --noEmit`: api · web 무에러. `@tripick/types` 재빌드 후 확인.
- eslint: 변경된 web 파일 무경고(0). `<img>` no-img-element · `set-state-in-effect` 는 관례/패턴으로 회피.
- 수동 확인 포인트:
  - 프로필 사진 있는 친구/멤버 → 아바타 이미지, 없거나 로드 실패 → 색상+이니셜 폴백
  - 미가입 핸들 추가 → "존재하지 않는 아이디예요." 토스트, 목록 무변화
  - 내 아이디 칩 복사 → "복사됨" 피드백, 클립보드에 `@handle`
  - 친구 행 여행 아이콘 → `/trips/new` 진입 시 해당 친구가 동행자 칩으로 선택됨
