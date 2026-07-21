# TriPick 인박스 · 여행 초대 v1

문서 목적: 친구 요청·재계획·여행 초대 등을 한 곳에 모으는 `/inbox` 페이지와, "친구를 trip 멤버로 자동 등록" 동작을 "초대 → 수락" 흐름으로 분리한 작업을 고정한다. main-planner v1 · trip-create v1 · friends/trip-members v1 위에 얹는 변경이며, 디자인 시스템 · FSD · mock/DB API · 화면 매핑 규칙은 동일한 흐름으로 정리한다.

기준 브랜치: `feat/inbox-setting-page`
작성일: 2026-06-19
선행 문서:
- [`docs/planner/main-planner-v1.md`](../planner/main-planner-v1.md)
- [`docs/trips/trip-create-v1.md`](../trips/trip-create-v1.md)
- [`docs/friends/friends-and-trip-members-v1.md`](../friends/friends-and-trip-members-v1.md)

기준 디자인 시스템: [`docs/design-system/toss-v1.md`](../design-system/toss-v1.md)

## 1. 배경 / 문제

직전 버전까지의 알림성 이벤트는 다음과 같이 분산돼 있었다.

| 이벤트                     | 출처                                  | 문제                                                                         |
| -------------------------- | ------------------------------------- | ---------------------------------------------------------------------------- |
| 친구 요청 (incoming)        | `/friends` 안의 "받은 요청" 섹션      | 친구 페이지에 들어가야만 보임. 다른 페이지에선 미인지                          |
| 재계획 결과 (`replan_ready`) | 백엔드 NotificationService (FCM 스텁) | 영속 저장 없음. 푸시만 가능, 인앱에선 사라짐                                  |
| 여행 초대                   | (개념 자체가 없음)                    | 멤버 시트에서 친구를 더하면 곧바로 `status: 'accepted'` — 친구 동의 없이 합류 |
| 날씨/리마인더               | 백엔드 채널 없음                      | 트리거할 자리도 표시할 자리도 없음                                            |
| FCM 푸시                   | NotificationService 가 TODO 로그만 출력 | google-services.json 미배치, firebase-admin 미초기화, RN 측 토큰 등록 동선 없음 |

해결 방향:
1. **인박스 페이지**: 영속 알림 + 친구 incoming 가상 row 를 통합해 `/inbox` 하나로 노출.
2. **DB 영속**: 새 `notifications` 테이블 + `NotificationCategory` 4종(`replan_ready` / `weather_alert` / `trip_reminder` / `general`) + 후속 `trip_invite` 추가.
3. **여행 초대 분리**: 친구를 멤버 시트로 추가 시 `friendUserId` 가 매칭되면 `pending` 상태로 두고, 초대받은 사용자의 인박스에 `trip_invite` 알림 발송 → 본인이 수락해야 `accepted`.
4. **하단 네비 4탭화**: 홈/취향/친구/**알림** (이후 설정 페이지 도입으로 5탭화 — `docs/settings/settings-v1.md`).
5. **FCM 실 발송 + RN 토큰 브릿지**: `firebase-admin` 초기화 + `InboxService.create()` 가 인박스 row 저장 직후 수신자 `fcmToken` 으로 푸시 fan-out. RN 측은 모듈러 API 로 토큰 발급 → WebView 브릿지 → 백엔드 `PATCH /users/me/fcm-token` 등록.

## 2. 범위

포함:
- 신규 라우트 `/inbox` (인박스 페이지)
- DB 영속 알림 (`NotificationEntity`, 카테고리 5종 — `replan_ready` / `weather_alert` / `trip_reminder` / `trip_invite` / `general`)
- 친구 요청은 정본을 `friends.incoming` 에 두고 인박스에 가상 row 로 직렬화
- 인박스 액션 처리: 친구 수락/거절, 초대 수락/거절, 알림 클릭 → 여행 이동
- 읽음 상태 (`readAt`), `unreadCount`, 모두 읽음, 필터(전체/읽지 않음/응답 필요), 시간 그룹(오늘/어제/이번 주/그 이전), 상대시간(분/시간/일)
- `replan_ready` 자동 생성: `MainPlannerService.swap()` 성공 시 사용자 인박스에 작성
- 여행 초대 → 수락/거절 흐름 (trip member `status: 'pending'` ↔ `'accepted'`)
- 초대 수락 시 owner 인박스에 `general` 알림 ("OO 님이 초대를 수락했어요")
- 초대 거절 시 owner 인박스에 `general` 알림 ("OO 님이 초대를 거절했어요")
- 멤버 시트의 `pending` 멤버를 점선 카드 + "초대 응답 대기" 칩 + "초대 취소" 버튼으로 시각 구분
- 조율(`getCoordination`) 에서 `pending` 멤버 vote 제외
- accepted 멤버가 owner 가 아니어도 trip 조회·목록 노출 (`TripsService.findVisible` / `findOneForViewer`)
- 하단 네비 3탭 → 4탭 (`알림` 추가) + 인박스 SVG 아이콘
- **FCM 푸시 실 발송**: `firebase-admin` 14.x modular API + `NotificationService.send()` 구현. env 미설정 시 no-op (개발 안전).
- **InboxService → FCM fan-out**: `create()` 가 row 저장 후 수신자 `fcmToken` 으로 비동기 발사. 푸시 실패가 인박스 흐름을 막지 않도록 `void`.
- **사용자 알림 카테고리 토글 게이팅**: `UsersService.prefersCategory(user, category)` 가 비활성 카테고리면 `create()` 단계에서 `null` 반환 — 인박스 row + 푸시 동시 차단. `weather_alert` 키는 내부적으로 `replan_ready` 로 매핑.
- **RN ↔ WebView FCM 브릿지**: RN `App.tsx` 가 토큰을 `FCM_TOKEN` 메시지로 WebView 에 주입, 웹 `RnBridge` 컴포넌트가 받아 `PATCH /users/me/fcm-token` 호출. `PUSH_NOTIFICATION` 메시지는 인박스 query invalidate.
- **포그라운드 / 백그라운드 / 종료 상태 표시**: 포그라운드는 `notifee.displayNotification`, 백그라운드/종료는 `setBackgroundMessageHandler` (`index.js` 등록).
- **네이티브 빌드 설정**: Android `google-services` Gradle plugin + iOS `FirebaseApp.configure()` (plist 존재 시에만 호출하는 가드). 패키지 ID `com.tripick.place`.
- **클라이언트 자격 파일 `.gitignore`**: `google-services.json` / `GoogleService-Info.plist` 는 비밀이 아니지만 환경 분리 대비로 secret 채널로 공유.

제외 / 후속:
- 실시간 WebSocket 으로 인박스 invalidate 푸시 (현재는 staleTime 30초 + 액션 invalidate + FCM `PUSH_NOTIFICATION` 브릿지로 보강)
- 자동 알림 트리거 (날씨/일정 리마인더) — `inboxService.create()` 만 호출하면 동작하지만 스케줄러 미도입
- 초대 취소 (owner 측 pending 삭제) 시 invitee 인박스 알림 — 현재 미발송
- `friendUserId` 가 없는 친구(수동 핸들 등록만) 초대 — 알림 보낼 곳이 없어 기존 `accepted` 즉시 합류 유지
- 디바이스별 푸시 토큰 분리 (`users.fcm_token` 단일 컬럼 → `FcmToken` 테이블 다중 토큰) — RN 앱·웹 푸시 동시 사용 시 마지막 토큰만 남는 한계
- Web Push (Service Worker + VAPID) — 현재는 RN 컨테이너 내부 사용자만 푸시 수신, 브라우저 단독 진입은 인박스 인앱만
- iOS APNs Auth Key 업로드 (실기기 푸시 테스트 단계에서 필요)

## 3. UX 결정 요약

- 인박스는 별도 라우트 + 하단 네비 진입. 다른 페이지의 헤더에 종 아이콘 등 추가 진입점은 두지 않는다 (중복 동선 회피).
- 친구 요청은 인박스에도 떠야 하지만 정본은 `friends.incoming` 으로 유지. 두 화면에서 같은 row 가 두 번 보이는 게 자연스러우며, 수락/거절 시 둘 다 invalidate.
- 카테고리별 톤은 5색으로 분리해 인박스에서 한눈에 종류를 구별: `friend_request` 파랑 / `trip_invite` 보라 / `replan_ready` 초록 / `weather_alert` 주황 / `trip_reminder` 파랑 / `general` 회색.
- 읽음 처리: 알림 카드 자체를 클릭하면 자동으로 읽음. 친구 요청·트립 초대 카드는 액션 버튼 외에는 클릭해도 읽음 처리하지 않음 (응답이 필요한 카드는 사라져야 하므로).
- 트립 초대 수락 시 자동으로 `/planner?tripId=...` 이동 (확인 즉시 일정 보이도록).
- 멤버 시트의 pending 멤버는 owner 시점에서 "초대 응답 대기" 라벨 + 점선 카드로 약하게 표시. 강조 색은 `#FF8A00` (warning) — 응답을 기다리고 있음을 환기.
- 조율 vote 는 pending 멤버를 제외. 응답 전까지는 trip 일정에 영향 주지 않도록.

## 4. 디자인 시스템 적용 매핑

선행 문서와 동일한 toss-v1 토큰만 사용한다. 인박스/초대 신규 매핑:

| 토큰                      | 사용 위치                                                                     |
| ------------------------- | ----------------------------------------------------------------------------- |
| `surface #FFFFFF`         | 인박스 카드, 멤버 시트 일반 row                                                 |
| `surface-muted #FAFBFC`   | 인박스 빈 상태, 멤버 시트 pending row 배경                                      |
| `primary #3182F6`         | `friend_request` / `trip_reminder` 톤, 읽지 않음 카드 border `#BFD7FF` + `#F4F8FF`, 모두 읽음 hover, 인박스 아바타 dot |
| `primary-pressed #1B64DA` | 카테고리 라벨 강조, 액션 버튼 hover                                            |
| `success #00A86B`         | `replan_ready` 톤                                                              |
| `warning #FF8A00`         | `weather_alert` 톤, 멤버 시트 "초대 응답 대기" 칩                              |
| `error #F04452`           | unread 빨간 dot, mutation 에러                                                 |
| `#7C3AED` (보라)          | `trip_invite` 톤 — toss-v1 의 1차 팔레트엔 없지만 강조 카테고리 구분용으로만 사용 |
| `divider #E5E8EB`         | 카드 border, 점선(`border-dashed`) 도 동일 색                                  |
| chip `#EAF2FF`            | 필터 활성 배경, AI 추천 카드와 톤 공유                                          |
| chip `#FFF4E6`            | 멤버 시트 "초대 응답 대기" 칩 배경                                              |

추가 비주얼 규칙:
- 카테고리별 emoji + 톤 색은 `KIND_META` 테이블에서 단일 출처 관리 ([inbox-view.tsx:KIND_META](../../apps/web/src/views/inbox/ui/inbox-view.tsx))
- unread 카드만 좌측 5px 영역에 빨간 dot — 클릭 가능 영역과 시각 구분.

## 5. FSD 디렉터리 구조 (이 작업 추가/변경 분)

```
apps/web/src/
├── app/
│   ├── inbox/page.tsx                              # 신규 라우트
│   └── providers.tsx                               # + <RnBridge /> 마운트
│
├── views/
│   └── inbox/ui/inbox-view.tsx                     # 인박스 페이지 (모바일 셸 + 데스크탑 카드)
│
├── entities/
│   ├── inbox/                                      # 신규: API + 타입 재노출
│   │   ├── api.ts                                  # fetch / markRead / markAllRead
│   │   └── index.ts
│   ├── trip-plan/api.ts                            # + acceptTripInvite / rejectTripInvite
│   └── user/api.ts                                 # + updateFcmToken (PATCH /users/me/fcm-token)
│
├── features/manage-trip-members/                   # pending row UI 보강
│
└── shared/
    ├── api/query-keys.ts                           # + inbox.list, + user.me
    ├── rn-bridge/rn-bridge.tsx                     # 신규: RN → Web postMessage 수신부 (FCM_TOKEN 등록 + PUSH_NOTIFICATION invalidate)
    └── ui/app-frame.tsx                            # 4번째 탭 `알림` + 인박스 SVG 아이콘
```

```
apps/mobile/
├── index.js                                        # + setBackgroundMessageHandler (modular API) + notifee 백그라운드 표시
├── src/App.tsx                                     # setupFcm: getMessaging / requestPermission / getToken / onTokenRefresh / onMessage + 포그라운드 notifee 표시
├── android/build.gradle                            # + classpath("com.google.gms:google-services:4.4.2")
├── android/app/build.gradle                        # + apply plugin: com.google.gms.google-services + namespace/applicationId = com.tripick.place
├── android/app/src/main/java/com/tripick/place/    # MainActivity / MainApplication 패키지 이동
├── ios/TriPick/AppDelegate.swift                   # + FirebaseApp.configure() (plist 존재 시에만)
└── ios/TriPick.xcodeproj/project.pbxproj           # PRODUCT_BUNDLE_IDENTIFIER = com.tripick.place
```

```
apps/api/src/
├── inbox/                                          # 신규 모듈
│   ├── notification.entity.ts                      # TypeORM 엔티티 (@Index userId+createdAt)
│   ├── inbox.service.ts                            # list / markRead / create (+ NotificationService 주입 → 푸시 fan-out)
│   ├── inbox.controller.ts                         # GET / PATCH /:id/read / POST /read-all
│   └── inbox.module.ts                             # + NotificationModule import
│
├── notification/
│   ├── notification.service.ts                    # firebase-admin 14.x modular API 실 발송 (env 미설정 시 no-op, 만료 토큰 silent drop)
│   └── notification.module.ts                     # NotificationService export
│
├── users/
│   ├── user.entity.ts                             # + notificationPreferences jsonb + fcmToken
│   ├── users.service.ts                           # + prefersCategory (weather_alert → replan_ready 매핑) + updateFcmToken
│   └── users.controller.ts                        # PATCH /users/me/fcm-token, /notification-preferences
│
├── trips/
│   ├── trips.service.ts                            # + findVisible / findOneForViewer
│   └── trips.module.ts                             # + TripMemberEntity import
│
├── trip-members/
│   └── trip-members.service.ts                     # findAll 에 viewer 허용, createFromFriend 가 pending 발행, acceptInvite / rejectInvite 추가, getCoordination 에서 pending 제외
│
├── main-planner/
│   ├── main-planner.service.ts                     # + InboxService 주입. swap 후 replan_ready 작성. addMember/acceptInvite/rejectInvite 가 invite 알림 발행
│   ├── main-planner.controller.ts                  # + PATCH /trips/:id/members/:id/accept-invite, DELETE /invite
│   └── main-planner.module.ts                      # + InboxModule
│
└── app.module.ts                                   # + InboxModule, + NotificationModule
```

규칙(선행 문서와 동일):
- import 방향: `entities` → `features` → `widgets` → `views` → `app`
- 라우트 단위 화면 조립은 `views/<route>/ui/<route>-view.tsx`. 컴포넌트명 `*View`.
- `entities/inbox` 는 view-agnostic API만. 카테고리별 라벨/톤 매핑은 view 안에서 관리(`KIND_META`).
- `NotificationCategory` 는 backend / web / shared types 모두 동일 정의 (`packages/types/src/inbox.ts`).

## 6. 타입 정의

[`packages/types/src/inbox.ts`](../../packages/types/src/inbox.ts)

```ts
type NotificationCategory =
  | 'replan_ready'
  | 'weather_alert'
  | 'trip_reminder'
  | 'trip_invite'
  | 'general';

type InboxItemKind = NotificationCategory | 'friend_request';

interface InboxItemActionDto {
  type:
    | 'open-trip'           // tripId 로 /planner 이동
    | 'open-friends'        // /friends 이동
    | 'accept-friend'       // PATCH /friends/:id/accept
    | 'reject-friend'       // DELETE /friends/:id
    | 'accept-trip-invite'  // PATCH /main-planner/trips/:id/members/:id/accept-invite
    | 'reject-trip-invite'; // DELETE /main-planner/trips/:id/members/:id/invite
  label: string;
  tripId?: string;
  tripMemberId?: string;
  friendId?: string;
}

interface InboxItemDto {
  id: string;                // notification id 또는 `friend-<id>` 가상 키
  kind: InboxItemKind;
  title: string;
  body: string;
  createdAt: string;         // ISO datetime
  readAt: string | null;     // 친구 요청·초대는 항상 null 처리 (액션 완료로 사라짐)
  actions: InboxItemActionDto[];
  payload?: Record<string, string>;
}

interface InboxSummaryDto {
  items: InboxItemDto[];
  unreadCount: number;
}

interface CreateNotificationDto {
  userId: string;
  category: NotificationCategory;
  title: string;
  body: string;
  payload?: Record<string, string>;
}
```

[`packages/types/src/main-planner.ts`](../../packages/types/src/main-planner.ts) 확장:

```ts
interface PlannerMemberDto {
  id: string;
  initial: string;
  color: string;
  friendId?: string | null;
  nickname?: string;
  role?: 'owner' | 'companion';
  status?: 'accepted' | 'pending';  // 신규 — pending 시 UI에서 점선 카드
}
```

## 7. API 명세

base URL: `http://localhost:4000/api/v1`
인증: 모든 엔드포인트 `JwtAuthGuard` 적용 (현재 사용자 = `@CurrentUser`)

### 7-1. 인박스

| Method | Path               | 응답                  | 비고                                 |
| ------ | ------------------ | --------------------- | ------------------------------------ |
| GET    | `/inbox`           | `InboxSummaryDto`     | DB 알림 + `friends.incoming` 통합, createdAt 내림차순 |
| PATCH  | `/inbox/:id/read`  | `InboxItemDto`        | notification id 만 유효 (friend row 는 invalid)       |
| POST   | `/inbox/read-all`  | `{ updated: number }` | 본인 `readAt IS NULL` 모두 갱신                       |

`GET /inbox` 동작:
1. `notifications` 테이블에서 `userId=user.id` 인 알림 최대 100건 fetch (createdAt DESC)
2. `friends` 테이블에서 `ownerId=user.id AND status='incoming'` row fetch
3. 각각 `InboxItemDto` 로 변환 후 `createdAt` 내림차순 병합
4. `unreadCount = incoming.length + notifications.filter(!readAt).length`

`fromFriend` 변환: `id: 'friend-<friend.id>'`, kind: `'friend_request'`, actions: `[accept-friend, reject-friend]` — friend.id 를 액션에 그대로 전달.

`actionsForNotification` 매핑 ([inbox.service.ts](../../apps/api/src/inbox/inbox.service.ts)):
- `trip_invite` (tripId + tripMemberId 필요) → `[accept-trip-invite, reject-trip-invite]`
- `replan_ready` / `trip_reminder` (tripId 필요) → `[open-trip "여행 보기"]`
- `weather_alert` (tripId 필요) → `[open-trip "일정 확인"]`
- `general` (tripId 있을 때) → `[open-trip "여행 보기"]`
- 그 외 → 빈 액션

### 7-2. 여행 초대

기존 `POST /main-planner/trips/:tripId/members` 의 동작이 바뀌었다.

| Method | Path                                                            | 응답                  |
| ------ | --------------------------------------------------------------- | --------------------- |
| POST   | `/main-planner/trips/:tripId/members`                           | `PlannerMemberDto[]`  |
| PATCH  | `/main-planner/trips/:tripId/members/:memberId/accept-invite`   | `PlannerMemberDto`    |
| DELETE | `/main-planner/trips/:tripId/members/:memberId/invite` (204)    | —                     |
| DELETE | `/main-planner/trips/:tripId/members/:memberId` (owner cancel)  | `PlannerMemberDto[]`  |

`addMember` 동작 변경 ([main-planner.service.ts](../../apps/api/src/main-planner/main-planner.service.ts)):
1. `friendsService.findAcceptedById` — 친구 status=accepted 만 가능
2. `tripMembersService.createFromFriend`:
   - `friend.friendUserId` 있음 → trip_member `status: 'pending'`, `userId: friendUserId`
   - 없음 → 기존대로 `status: 'accepted'`
3. 만들어진 member 가 pending + invitedUserId 있으면 → invitee 인박스에 `trip_invite` 알림:
   - title: `"${inviterNickname} 님의 여행 초대"`
   - body: `"${tripTitle}" (${destination}, ${startDate} ~ ${endDate})에 함께 떠나요!`
   - payload: `{ tripId, tripMemberId, inviterNickname }`

`acceptInvite` ([trip-members.service.ts](../../apps/api/src/trip-members/trip-members.service.ts)):
- `member.userId === currentUser.id` 검증 (본인 초대만)
- `status='accepted'`, `nickname = currentUser.nickname` 갱신
- main-planner 측에서 owner 에게 `general` 알림 "OO 님이 초대를 수락했어요"

`rejectInvite`:
- 동일 검증 후 row 삭제
- owner 에게 `general` 알림 "OO 님이 초대를 거절했어요"
- owner 가 자기 자신인 경우(자기 초대 거절 = 불가능 케이스) 알림 생략

### 7-3. trip 조회 권한 확장

`TripsService` ([trips.service.ts](../../apps/api/src/trips/trips.service.ts)):
- `findVisible(userId)` — owner trips + accepted 멤버로 등록된 trips 를 합쳐 createdAt 내림차순 반환
- `findOneForViewer(id, userId)` — owner 또는 accepted 멤버 가 조회 가능. mutation path 에선 기존 `findOne` (owner-only) 유지

`TripMembersService.findAll` ([trip-members.service.ts](../../apps/api/src/trip-members/trip-members.service.ts)):
- owner: 기존 `ensureOwnerMember` (owner row 자동 생성/동기화)
- accepted 멤버: `status='accepted'` 멤버십 확인 후 읽기 허용
- 그 외: `ForbiddenException`

`MainPlannerService`:
- `listTrips` → `findVisible`
- `getTrip` → `findOneForViewer`

### 7-4. 자동 발신 알림

| 트리거                           | 카테고리       | payload                                  |
| -------------------------------- | -------------- | ---------------------------------------- |
| `MainPlannerService.swap()` 성공  | `replan_ready` | `{ tripId, itemId }`                     |
| `addMember` (pending 생성)        | `trip_invite`  | `{ tripId, tripMemberId, inviterNickname }` |
| `acceptInvite` 성공               | `general`      | `{ tripId }` (owner 에게)                |
| `rejectInvite` 성공               | `general`      | `{ tripId }` (owner 에게)                |

### 7-5. FCM 푸시 발송 (`NotificationService`)

`InboxService.create()` 가 row 저장 직후 수신자의 `fcmToken` 이 있으면 `notificationService.send()` 호출. 인박스 흐름과 푸시 결과는 독립 — 푸시 실패는 인박스 row 에 영향 없음(`void` fire-and-forget).

| 항목                       | 값                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| SDK                        | `firebase-admin@14` modular API (`getMessaging`, `cert`, `initializeApp`)                            |
| 초기화 조건                 | env 3개(`FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY`) 모두 있을 때만     |
| 미초기화 시 동작           | `send()` no-op + debug 로그 — 개발 환경에서 인박스 로직만 단독 테스트 가능                            |
| `FIREBASE_PRIVATE_KEY` 형식 | `\n` 리터럴이 포함된 한 줄 문자열. 서비스 코드에서 `.replace(/\\n/g, '\n')` 로 실 개행 복원           |
| Android payload            | `priority: 'high'`, `notification.channelId: 'tripick-default'`, `sound: 'default'`                  |
| iOS payload                | `apns.payload.aps.sound: 'default'`                                                                  |
| `data` 필드                | string-only 제약 — `stringifyPayload` 헬퍼로 비-string 값 JSON 직렬화. `notificationId` / `category` 자동 추가 |
| 만료 토큰 처리             | `messaging/registration-token-not-registered` / `messaging/invalid-registration-token` → warn 만, throw 안 함 (호출자 보호) |
| 카테고리 게이팅            | `InboxService.create()` 가 `prefersCategory` 로 인박스 row + 푸시 동시 차단. `weather_alert` 키는 `replan_ready` 토글로 함께 제어 |

### 7-6. RN ↔ WebView FCM 브릿지

| 방향        | 메시지 타입         | 동작                                                                                |
| ----------- | ------------------- | ----------------------------------------------------------------------------------- |
| RN → Web    | `FCM_TOKEN`         | RN `App.tsx` 가 `getToken()` 직후 + `onTokenRefresh` 시 발송. 웹은 `updateFcmToken()` 호출. `sessionStorage.tripick.fcm.lastToken` 으로 중복 등록 차단 |
| RN → Web    | `PUSH_NOTIFICATION` | RN `onMessage` (포그라운드) 가 발송. 웹은 `queryKeys.inbox.list` invalidate          |
| Web → RN    | (기존) `REQUEST_LOCATION` / `OPEN_EXTERNAL` 등 | 변경 없음                                                                |

웹은 `Providers` 에 `<RnBridge />` 마운트, 브라우저 단독 진입 시엔 메시지 자체가 안 와 no-op.

RN 측 표시 정책:
- **포그라운드** (`onMessage`): `notifee.displayNotification` 으로 직접 표시. 알림 채널 `tripick-default` (`AndroidImportance.HIGH`).
- **백그라운드 / 종료 상태** (`setBackgroundMessageHandler`, `index.js`): payload 에 `notification` 필드 있으면 OS 가 표시, data-only 면 notifee 가 직접 표시.

세션 미로그인 시 `RnBridge` 는 토큰 등록을 건너뛰고, 로그인 후 다음 토큰 발사 시 재시도 (`sessionStorage` 의 `lastToken` 도 갱신 안 됨).

## 8. 화면 컴포넌트 매핑

### 8-1. `/inbox` 인박스 페이지

| 영역                       | 컴포넌트                                                                  |
| -------------------------- | ------------------------------------------------------------------------- |
| 모바일 헤더 + unread 배지   | `views/inbox/ui/inbox-view.tsx` 인라인                                     |
| 데스크탑 헤더 + 친구 목록 링크 | 동일 view 인라인                                                          |
| 필터 chip (전체/읽지 않음/응답 필요) | 인라인 — `FILTERS` 상수                                             |
| 모두 읽음 버튼              | unreadCount 0 일 때 disabled                                              |
| 빈 상태                     | 인라인 — 필터별 다른 안내문                                                 |
| 시간 그룹 헤더              | `groupByDate` — 오늘 / 어제 / 이번 주 / 그 이전                            |
| 인박스 row                  | `InboxRow` (이모지 + 카테고리 라벨 + unread dot + 상대시간 + 본문 + 액션 row) |
| 액션 버튼                   | primary (`accept-friend` / `accept-trip-invite` / `open-trip`) + secondary |

`KIND_META` 5종:
- `friend_request` 👋 파랑 `#3182F6`
- `trip_invite` 🎟️ 보라 `#7C3AED`
- `replan_ready` ✨ 초록 `#00A86B`
- `weather_alert` ☔ 주황 `#FF8A00`
- `trip_reminder` 🧳 파랑 `#1B64DA`
- `general` 📬 회색 `#6B7684`

### 8-2. 멤버 시트 pending UI

[`features/manage-trip-members/ui/trip-members-sheet.tsx`](../../apps/web/src/features/manage-trip-members/ui/trip-members-sheet.tsx):

| 상태       | 카드 스타일                              | 우측 버튼  |
| ---------- | ---------------------------------------- | ---------- |
| owner      | 실선 + 흰 배경 + "본 여행 기본 멤버" 칩  | 없음        |
| accepted   | 실선 + 흰 배경                           | `제외`     |
| pending    | **점선** + `#FAFBFC` 배경 + "초대 응답 대기" 칩(`#FFF4E6` 배경 / `#FF8A00` 텍스트) | `초대 취소` |

### 8-3. 하단 네비게이션

[`shared/ui/app-frame.tsx`](../../apps/web/src/shared/ui/app-frame.tsx):
- `grid-cols-3` → `grid-cols-4`
- `NAV_ITEMS` 끝에 `{ href: '/inbox', label: '알림', icon: 'inbox' }` 추가
- `NavIcon` 에 `inbox` case 추가 (편지봉투 + 줄 2개 SVG)

## 9. 사용자 플로우

### 9-1. 인박스 진입 / 일반 알림 처리

1. `/inbox` 진입 → `GET /inbox`
2. 카드 자체 클릭 (알림 카테고리만) → `PATCH /inbox/:id/read` → unread dot 제거
3. `여행 보기` / `일정 확인` 액션 → 읽음 처리 + `/planner?tripId=...` 이동
4. `모두 읽음` → `POST /inbox/read-all`

### 9-2. 여행 초대 발송

1. Owner 가 `/planner` 헤더 아바타 클릭 → 멤버 시트 오픈
2. 친구 목록에서 `추가` 클릭 → `POST /main-planner/trips/:tripId/members`
3. invitee 가 실 사용자(`friendUserId` 매칭)면 trip_member `status='pending'` 으로 생성, invitee 인박스에 `trip_invite` 알림 작성
4. 멤버 시트 즉시 갱신 — pending row 점선 카드 + "초대 응답 대기" 칩 노출

### 9-3. 초대 수락

1. invitee `/inbox` 진입 → 보라 톤 🎟️ "여행 초대" 카드 노출
2. `수락` 클릭 → `PATCH /main-planner/trips/:tripId/members/:memberId/accept-invite`
3. 알림 자동 읽음 + 인박스에서 사라짐 + `/planner?tripId=...` 이동
4. 백엔드: trip_member `status='accepted'`, nickname 본인 닉네임으로 갱신
5. owner 인박스에 `general` "OO 님이 초대를 수락했어요" 알림 작성

### 9-4. 초대 거절

1. `거절` 클릭 → `DELETE /main-planner/trips/:tripId/members/:memberId/invite`
2. 인박스에서 카드 사라짐
3. 백엔드: trip_member row 삭제
4. owner 인박스에 `general` "OO 님이 초대를 거절했어요" 알림 작성

### 9-5. 친구 요청

`/friends` 의 "받은 요청" 섹션과 `/inbox` 의 친구 요청 카드는 같은 정본을 공유. 어느 쪽에서 수락/거절해도 양쪽 모두 invalidate 되어 동기화.

## 10. 검증

```bash
pnpm --filter @tripick/types build
pnpm --filter @tripick/api typecheck
pnpm --filter @tripick/web typecheck
```

수동 검증 절차:
1. 동일 백엔드에 사용자 A · B 둘 다 카카오 로그인. (B 가 친구 추가 시 매칭되도록 `kakaoId` 또는 `nickname` 사전 등록)
2. A 가 `/friends` 에서 B 의 handle 입력 → B 인박스에 친구 요청 노출 확인
3. B `/inbox` → 친구 요청 카드 `수락` → 양쪽 친구 목록에 상대 노출
4. A 가 trip 생성 → `/planner` 헤더 아바타 → 시트에서 B 추가 → A 시트에 "초대 응답 대기" 점선 row 노출
5. B `/inbox` → 보라 🎟️ "여행 초대" 카드 → `수락` → 자동으로 A 의 trip `/planner?tripId=...` 진입, B 의 `/trips` 목록에도 등장
6. A `/inbox` → `general` "B 님이 초대를 수락했어요" 알림 확인
7. A 가 다른 친구 C 초대 → C 가 `거절` → A `/inbox` 에 거절 알림 노출
8. A 가 `/planner` 일정 카드 → `대안 시트` → `대안으로 변경` → A `/inbox` 에 `replan_ready` 알림 + "여행 보기" 액션 확인
9. `/inbox` 필터 (전체/읽지 않음/응답 필요) 동작 확인 + `모두 읽음` 후 unread badge 0 확인
10. B 가 `/planner?tripId=...` 진입 시 owner 가 아니어도 trip 일정 조회 가능, 단 멤버 시트의 `추가`/`제외` 등 mutation 은 owner 에게만 노출되어야 한다 (현재는 모두 owner UI 동일 노출 — backlog: viewer 모드 UI 분리)

## 11. 후속 작업 (backlog)

- **WebSocket 인박스 invalidate 푸시** — RN 컨테이너 밖(브라우저 단독) 사용자는 FCM `PUSH_NOTIFICATION` 브릿지를 못 받음. 같은 신호를 socket 채널 `inbox:<userId>` 로 보내 모든 클라이언트에서 `queryClient.invalidateQueries(queryKeys.inbox.list)` 동기화.
- **`FcmToken` 테이블 분리** — 현재 `users.fcm_token` 단일 컬럼이라 같은 사용자가 RN + 웹 동시 사용 시 마지막 토큰만 남음. 디바이스/플랫폼별 다중 토큰 관리 + 만료 시 자동 제거.
- **Web Push (Service Worker + VAPID)** — 브라우저 단독 진입 사용자도 푸시 수신. Firebase 웹 앱 등록 + Next.js `firebase-messaging-sw.js` 필요.
- **자동 알림 스케줄러** — `@nestjs/schedule` + 기상청 단기예보 + 트립 D-1/D-day 리마인더. `weather_alert` / `trip_reminder` 카테고리는 type 만 있고 트리거 없음.
- **invitee 측 trip 뷰의 owner 전용 UI 숨김** — `findOneForViewer` 로 일단 조회는 풀었지만 멤버 시트의 `추가/제외/swap` 버튼은 owner 만 보여야 한다.
- **owner 가 pending 멤버 취소 시 invitee 알림** — 현재 무음 삭제. `trip_invite` 자체를 인박스에서 제거하지만 별도 메시지는 없음.
- **`friend.friendUserId` 가 없는 핸들 친구의 초대** — 현재 즉시 accepted 합류 유지. 가입 유도 푸시 흐름이 필요.
- **알림 페이지에서 카테고리별 sub-filter** — 지금은 응답 필요 vs 일반만 구분. 필요해지면 chip 1열 추가.
- **알림 archive / 삭제** — 영구 보존이라 양이 늘어남. 30일 자동 archive 정책 필요.
- **iOS APNs 실기기 검증** — APNs Auth Key 업로드 + Xcode `Push Notifications` / `Background Modes: Remote notifications` capability 활성화.
- **App Check 활성화** — Android Play Integrity / iOS DeviceCheck 로 클라이언트 검증. 현재는 패키지명 + SHA-1 기준 보호만.

## 12. 결정 요약

1. 알림은 별도 영속 테이블(`notifications`) + 친구 incoming 은 정본을 `friends` 에 둔 채 인박스에서 가상 row 로 직렬화한다.
2. 카테고리 5종 + 친구 요청 가상 row 로 인박스 정보 흐름이 통일된다. 도메인 이벤트는 모두 `inboxService.create()` 를 통해 들어온다.
3. 친구 → 트립 멤버 자동 합류를 폐기하고 "초대 → 수락" 흐름으로 분리. invitee 가 실 사용자일 때만 pending, 아니면 즉시 accepted.
4. invitee 의 trip 조회 권한은 `findVisible` / `findOneForViewer` 두 메서드로 부드럽게 확장. mutation 권한(owner-only) 은 기존 `findOne` 으로 보호.
5. 조율은 accepted 멤버만 vote 집계에 포함해 pending 응답이 결과를 오염시키지 않도록 한다.
6. 하단 네비 4탭화 (`홈 / 취향 / 친구 / 알림`) — 알림은 다른 도메인과 동등한 1차 정보 영역으로 본다. (`/settings` 도입으로 5탭화는 별도 문서.)
7. mock 한계로 잡혀있던 "친구를 trip 에 추가해도 voters 자동 합류 안 됨" 은 invite 흐름으로 해소. 다만 자동 알림 트리거 / WebSocket 푸시는 별도 backlog.
8. FCM 푸시는 `InboxService.create()` 에서 인박스 row 저장 직후 fan-out — 두 채널을 한 번에 트리거. 푸시 실패는 인박스에 영향 없음(`void` fire-and-forget).
9. RN 컨테이너의 FCM 토큰은 WebView 브릿지(`FCM_TOKEN`) 로 웹에 전달, 웹이 `PATCH /users/me/fcm-token` 으로 백엔드 등록. 토큰 갱신·재설치 시 `onTokenRefresh` 로 자동 동기화.
10. 브라우저 단독 진입(RN 컨테이너 외부) 사용자는 푸시 미수신 — 인박스 인앱으로만 알림 노출. Web Push 는 후속 backlog.
11. 알림 카테고리 토글은 `UsersService.prefersCategory` 한 곳에서 인박스 + 푸시를 동시에 차단. `weather_alert` 는 `replan_ready` 토글에 종속.
12. Firebase 자격 파일(`google-services.json` / `GoogleService-Info.plist`) 은 비밀이 아니지만 환경 분리·App Check 도입 전 단계에서 secret 채널로 공유 (`.gitignore`).
