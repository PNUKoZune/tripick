# 친구 요청 푸시 + 푸시 탭 딥링크 라우팅 v1

문서 목적: [`docs/notification/fcm-production-push-v1.md`](./fcm-production-push-v1.md) 1절 "제외"에서 backlog로 넘겼던 `friend_request` 푸시와 `weather_alert` 발신처를 정리하고, 그 과정에서 발견한 "푸시 탭 라우팅 부재"를 함께 닫는다. 알림을 눌러도 이동이 되지 않던 갭을 RN→Web 딥링크 브릿지로 마감한다.

기준 브랜치: `feat/friend-request-push`
작성일: 2026-07-14
관련 문서: [`docs/notification/fcm-production-push-v1.md`](./fcm-production-push-v1.md) (토큰 생명주기·`sendToUser`·재계획 통지), [`docs/notification/inbox-and-trip-invite-v1.md`](./inbox-and-trip-invite-v1.md) (인박스 카테고리·수신설정·가상 row), [`docs/friends/friends-and-trip-members-v1.md`](../friends/friends-and-trip-members-v1.md) (친구 요청 incoming row)

## 1. 범위

포함:

- `friend_request` 푸시 — 친구 요청 생성 시 수신자에게 FCM 발송 (인박스 가상 row 유지, 영속 X)
- `weather_alert` 카테고리 분기 — 재계획 통지를 트리거 기반으로 분기(`weather` → `weather_alert`)하는 **잠재 배선**
- 푸시 탭 딥링크 라우팅 — 포그라운드/백그라운드/종료 상태 3경로 탭을 캡처해 category·tripId 기반으로 화면 이동

제외 (여전히 backlog):

- `weather` 트리거로 재계획 잡을 등록하는 진입점(스케줄러). 날씨 예보 변화 감지 → replan enqueue 파이프라인이 붙기 전까지 `weather_alert`는 무발화. 붙는 순간 아래 4절 분기가 자동으로 올바른 카테고리를 발신한다.
- notifee 백그라운드 이벤트 헤드리스 등록. 백엔드가 `notification` payload를 실어 백그라운드/종료 상태에선 OS가 알림을 표시하므로, 탭은 messaging의 `onNotificationOpenedApp`/`getInitialNotification`로 충분하다.

## 2. friend_request 푸시 — 가상 row 유지, 푸시만

배경: 수신설정에 `friend_request: true` 토글은 있으나(`NotificationPreferenceKey`), friends 흐름이 인박스 저장도 푸시도 하지 않아 토글이 무동작이었다. 인박스 **표시**는 이미 friends 테이블 기반 가상 row(`InboxService.fromFriend`)로 동작 중 — 진짜 빠진 건 푸시뿐.

> 결정: `friend_request`를 `NotificationCategory`로 **승격하지 않는다**. 승격 시 인박스에 영속 `NotificationEntity` row가 생겨 가상 row와 **중복**되고, "친구 요청 readAt은 항상 null, 액션 완료 시 사라짐" 시맨틱이 `markRead`/`readAt` 모델과 충돌한다. 대신 영속 없이 푸시만 보낸다.

- `packages/types/src/notification.ts` — 푸시 `type` 필드를 `NotificationCategory` → `NotificationPreferenceKey`로 확장해 `friend_request`를 허용. (인박스 카테고리 5종 + friend_request)
- `apps/api/src/inbox/inbox.service.ts` — `notifyFriendRequest(recipient, requester)` 신설. `prefersCategory(recipient, 'friend_request')` 토글 체크 후 `NotificationEntity` 저장 없이 `sendToUser`만 호출. 푸시 실패는 friends 흐름에 영향 없음(fire-and-forget).
- `apps/api/src/friends/friends.service.ts` — `createIncomingRequest`에서 **새 incoming row가 생성된 경우에만** 호출. 중복 요청(early-return) 경로엔 재발송하지 않아 스팸 방지.
- `apps/api/src/friends/friends.module.ts` — `InboxModule` import. 모듈 순환 없음(`FriendsModule → InboxModule → UsersModule·NotificationModule`, 역방향 import 없음).

## 3. weather_alert — 트리거 기반 카테고리 분기 (잠재)

`apps/api/src/alternative/alternative.processor.ts` `notifyRecipients`

- 그동안 재계획 통지는 트리거와 무관하게 `category: 'replan_ready'` 고정이었다.
- `trigger === 'weather' ? 'weather_alert' : 'replan_ready'`로 분기. 수신 토글은 `weather_alert`가 `prefersCategory` 내부에서 `replan_ready`로 remap되어 공유되므로 게이트 동작은 동일하고, 달라지는 건 인박스 카테고리·액션 라벨(`open-trip` "일정 확인")과 푸시 `type` 문자열.
- `weather` 트리거로 replan 잡을 enqueue하는 코드는 아직 없다(1절 제외). 이 분기는 진입점이 붙는 순간 올바른 카테고리를 발신하도록 미리 깔아둔 것 — NOTE 주석으로 backlog 명시.

## 4. 푸시 탭 딥링크 라우팅 — RN → Web

발견: 기존엔 **탭 라우팅 인프라가 전무**했다. 포그라운드 메시지를 notifee로 표시하고 인박스를 invalidate하는 경로(`PUSH_NOTIFICATION`)만 있었을 뿐, 어떤 알림을 눌러도 화면 이동이 일어나지 않았다. friend_request만 특수 처리하는 대신 범용 탭→라우팅 브릿지를 깔았다.

### 4.1 모바일 — 탭 3경로 캡처

`apps/mobile/src/App.tsx`

| 앱 상태 | 캡처 API | 처리 |
| ---- | ---- | ---- |
| 포그라운드 | `notifee.onForegroundEvent` (`EventType.PRESS`) | notifee 알림에 `data`를 실어 표시 → 탭 시 payload 라우팅 |
| 백그라운드(실행 중) | `messaging.onNotificationOpenedApp` | OS 표시 알림 탭 → 포그라운드 전환 시 라우팅 |
| 종료 상태 | `messaging.getInitialNotification` | 탭으로 앱 기동 → WebView 준비 전이라 보관 후 flush |

- `dispatchNotificationTap(data)` — FCM data(값이 `string | object`)를 `Record<string,string>`로 보정(`normalizeTapData`) 후 `NOTIFICATION_TAP` 브릿지 전송.
- 포그라운드 표시 시 `notifee.displayNotification`에 `data`를 실어야 PRESS 이벤트가 payload를 들고 온다.

### 4.2 콜드스타트 유실 방지 — WEB_READY 핸드셰이크

종료 상태 탭은 WebView(웹 리스너)가 붙기 전에 도착한다. 그대로 `postMessage`하면 유실된다.

- RN: `getInitialNotification` 결과를 `pendingTapRef`에 보관.
- 웹: `rn-bridge`가 `message` 리스너를 붙인 **직후** `window.ReactNativeWebView.postMessage({ type: 'WEB_READY' })` 발신.
- RN: `WEB_READY` 수신 시 보관해둔 탭을 flush → 유실 없이 라우팅.
- 포그라운드/백그라운드 경로는 웹이 이미 로드된 상태라 즉시 전달(핸드셰이크 불필요).

### 4.3 웹 — category 기반 라우팅

`apps/web/src/shared/rn-bridge/rn-bridge.tsx` `routeForNotification(data)`

| category | 도착지 |
| ---- | ---- |
| `friend_request`, `trip_invite` | `/inbox` (수락/거절 액션 위치) |
| `replan_ready`, `weather_alert`, `trip_reminder`, `general` | `tripId` 있으면 `/planner?tripId=…`, 없으면 `/inbox` |

- `NOTIFICATION_TAP` 수신 → 인박스 invalidate + `router.push(route)`.
- `data.category ?? data.type`로 카테고리를 읽는다(백엔드가 두 키 모두 실음).

> 참고: `friend_request` 탭을 `/inbox`로 보낸 건 UX 선택이다. 친구 요청은 `/inbox`(가상 row)와 `/friends`("받은 요청" 섹션) **양쪽 모두 수락/거절 버튼**이 있어 기능 차이는 없다. 다른 푸시와 도착지 일관성을 위해 인박스로 통일했다.

## 5. 검증

- API·웹·모바일 `tsc --noEmit` 통과. `@tripick/types` 빌드 통과.
- 관련 테스트:
  - `test/friends/friends.e2e-spec.ts` — 신규 incoming 요청 시 수신자에게 `notifyFriendRequest` 호출됨을 stub으로 검증(9건).
  - `test/inbox/inbox.e2e-spec.ts` — 회귀 통과(6건).
  - `test/notification/notification.service.spec.ts` — 회귀 통과(11건).
- (참고) 저장소 eslint 설정이 eslint v9와 호환되지 않아 `lint` 스크립트는 이 브랜치와 무관하게 실패 — typecheck로 대체 검증.

## 6. 커밋

1. `친구 요청 푸시 배선 + 날씨 트리거 알림 카테고리 분기` — friend_request push-only, weather_alert 트리거 분기
2. `푸시 탭 딥링크 라우팅 (RN → Web)` — 탭 3경로 캡처, WEB_READY 핸드셰이크, category 기반 라우팅
