# FCM 푸시 production 품질 v1

문서 목적: 스캐폴딩만 있던 FCM 푸시를 production 수준으로 마감한 작업을 고정한다. 단일 컬럼 토큰을 멀티 디바이스 테이블로 분리하고, 재계획 결과를 인박스·FCM으로 실제 발송하도록 배선하며, 토큰 생명주기(등록·만료 정리·로그아웃 해제·계정 삭제·로그인 전 유실)를 닫는다.

기준 브랜치: `feat/fcm-production-push`
작성일: 2026-07-14
관련 문서: [`docs/overview/product-v1-scope.md`](../overview/product-v1-scope.md) (2.E 재계획 — "푸시 알림 production 품질"·"자동 이탈 감지/FCM은 이후 단계"로 제외했던 항목), [`docs/planner/realtime-websocket-v1.md`](../planner/realtime-websocket-v1.md) (재계획 결과를 WebSocket으로만 내보내던 수신부), [`docs/notification/inbox-and-trip-invite-v1.md`](./inbox-and-trip-invite-v1.md) (인박스·수신설정)

## 1. 범위

포함:

- `users.fcmToken` 단일 컬럼 → `fcm_tokens` 테이블 분리 (사용자 1 : 토큰 N, 멀티 디바이스)
- `NotificationService.sendToUser` — 유저의 모든 기기로 발송 + 만료/무효 토큰 자동 정리
- 재계획 완료/최종 실패를 트립 수신자(owner + accepted 멤버)에게 인박스 + FCM으로 통지
- 로그아웃 시 해당 기기 토큰 서버에서 해제 (`DELETE /users/me/fcm-token`)
- 계정 삭제 시 해당 유저의 모든 토큰 정리
- 로그인 전 도착한 토큰 보관 후 로그인 완료 시 등록(pending flush)

제외 (별도 브랜치/backlog):

- `friend_request` 푸시 (수신설정 토글은 있으나 friends 흐름이 인박스·푸시 미발신 — 카테고리 체계 설계 필요)
- `weather_alert` 발신처 (카테고리·수신설정·인박스 액션은 준비됐으나 이 카테고리로 알림을 만드는 코드 없음)
- 프로덕션 스키마 마이그레이션 경로 (`fcm_tokens` 포함 전 엔티티가 dev `synchronize` 의존 — FCM 무관 레포 전반 과제)

## 2. 데이터 모델 — 토큰 테이블 분리

`apps/api/src/notification/fcm-token.entity.ts` — `fcm_tokens`

- `userId`(index), `token`(**unique** index), `platform`(nullable, 진단용), `createdAt`/`updatedAt`.
- 토큰은 전역 유일. 같은 기기가 다른 계정으로 재로그인하면 소유 `userId`만 갱신(upsert)된다.
- `users.fcmToken` 컬럼 제거. `PublicProfile`·`toSafe`·`updateFcmToken` 등 참조 정리. `autoLoadEntities: true`라 별도 등록 불필요.

`apps/api/src/notification/fcm-token.service.ts`

| 메서드 | 역할 |
| ---- | ---- |
| `register(userId, token, platform?)` | upsert (`conflictPaths: ['token']`) — 재등록 시 소유자 갱신 |
| `listTokens(userId)` | 유저의 모든 기기 토큰 |
| `remove(token)` | 만료/무효 토큰 제거 (발송 실패 시) |
| `removeForUser(userId, token)` | 로그아웃 — userId 스코프로 좁혀 타 유저 토큰 보호 |
| `removeAllForUser(userId)` | 계정 삭제 — 유저 전체 토큰 정리 |

## 3. 발송 경로 — sendToUser + 만료 정리

`apps/api/src/notification/notification.service.ts`

- `send(dto, token)`: 반환값을 `'ok' | 'invalid' | 'skipped'`로 변경. 만료/미등록 토큰(`registration-token-not-registered`·`invalid-registration-token`)은 throw 대신 `'invalid'` 반환.
- `sendToUser(dto)`: `listTokens` → 기기별 `send` 병렬 발송 → `'invalid'` 토큰은 `remove`로 즉시 정리. 토큰 조회/정리(DB) 실패가 호출자(주로 fire-and-forget)로 전파되지 않도록 전체를 try/catch로 감싼다("호출자는 await만 하면 됨" 계약 유지).
- 기존 단일 발송 호출부([inbox.service.ts])도 `send(dto, receiver.fcmToken)` → `sendToUser(dto)`로 전환. 수신설정 게이트(`prefersCategory`)는 그대로 유지.

## 4. 재계획 결과 → 인박스 + FCM 배선

`apps/api/src/alternative/alternative.processor.ts`

- 그동안 재계획 결과는 `RealtimeGateway.pushReplanResult`(WebSocket)로만 나갔다 → 앱이 백그라운드/미접속이면 결과를 못 받음.
- 완료 시 / **최종 재시도 실패 시**(중간 재시도는 조용히) 트립 수신자 전원에게 `inboxService.create({ category: 'replan_ready', ... })` 호출 = 인박스 저장 + FCM 푸시 + 수신설정 존중이 한 경로로 처리된다.
- `isFinalAttempt(job)` = `attemptsMade + 1 >= (opts.attempts ?? 1)`. bullmq 5.x의 `shouldRetryJob`(`attemptsMade + 1 < attempts`)과 정확히 부정 관계 — 처리 중엔 `attemptsMade`가 증가 전이라 off-by-one 없음. 완료/실패 각각 1회만 통지(중복 없음).
- 수신자 = `TripMembersService.getNotificationTargets(tripId)` → 트립 owner + `status='accepted'` 이면서 `userId`가 연결된 멤버(Set dedup). 통지 실패는 try/catch로 삼켜 잡 자체엔 영향 없음.

> 결정: 완료 푸시를 **트리거한 본인만이 아니라 트립 멤버 전원**에게 보낸다. `ReplanRequestDto`에 트리거 userId가 실리지 않고, 재계획 결과는 공유 일정이라 인박스 의미상 전원 통지가 맞다. 본인만 받게 하려면 DTO에 userId 추가가 필요.

## 5. 토큰 생명주기 — 등록/해제 흐름

end-to-end: 모바일 `App.tsx` `getToken`/`onTokenRefresh` → WebView 브릿지 `FCM_TOKEN` → 웹 `rn-bridge` → `PATCH /users/me/fcm-token` → `register` upsert.

**등록** — `apps/web/src/shared/rn-bridge/rn-bridge.tsx`

- 세션 있음: 마지막 등록 토큰과 다르면 `updateFcmToken` → `setLastFcmToken` + `clearPendingFcmToken`.
- 세션 없음(로그인 전): 버리지 않고 `setPendingFcmToken`으로 보관.

**로그인 전 유실 방지(pending flush)** — `apps/web/src/entities/user/api.ts`

- `flushPendingFcmToken()`: 보류 토큰이 있으면 등록 → last로 승격 → pending 정리. best-effort(실패 시 pending 유지, 다음 기회 재시도).
- 로그인 3개 경로에서 세션 저장 직후 호출: `loginWithEmail`·`startDemoSession`([auth-api.ts]), 카카오 콜백([kakao-callback-view.tsx]).

**로그아웃 해제** — `apps/web/src/entities/session/api/auth-api.ts` `logout()`

- 세션 제거 **전**(access token 유효 시점)에 마지막 등록 토큰으로 `deleteFcmToken` → `DELETE /users/me/fcm-token?fcmToken=…` → `removeForUser`. best-effort.
- 미해제 시 로그아웃한 기기가 이전 사용자 앞으로 오는 푸시를 계속 받는 문제를 막는다.

**계정 삭제** — `apps/api/src/users/users.service.ts` `remove()`

- 유저 삭제 직전 `removeAllForUser(id)`로 다른 기기 토큰까지 정리(orphan row 방지).

**저장 키 공용화** — `apps/web/src/shared/rn-bridge/fcm-token-storage.ts`

- `tripick.fcm.lastToken`(중복 등록 방지) / `tripick.fcm.pendingToken`(로그인 전 보관) sessionStorage 키를 헬퍼로 분리해 rn-bridge·로그아웃·flush에서 공용.

## 6. API 계약 변경

| 메서드 | 경로 | 변경 |
| ---- | ---- | ---- |
| PATCH | `/users/me/fcm-token` | body `{ fcmToken, platform? }` — 토큰 테이블 upsert(멀티 디바이스). 기존 `fcmToken` 필드 유지로 웹/모바일 호환 |
| DELETE | `/users/me/fcm-token?fcmToken=…` | 신설. 호출자 소유 토큰만 해제 |

## 7. 검증

- API·웹 `tsc --noEmit` 통과.
- API 유닛 125개 통과. 관련 스펙:
  - `test/notification/notification.service.spec.ts` — send 반환값, sendToUser 다건 발송·만료 토큰 제거·throw 안전성
  - `test/alternative/alternative.processor.spec.ts` — 완료/최종실패 통지, 중간 재시도 무통지(isFinalAttempt)
  - `test/users/users.e2e-spec.ts` — 토큰 upsert, 로그아웃 해제·타 유저 토큰 보호, 계정 삭제 시 토큰 정리
  - `test/inbox/inbox.e2e-spec.ts` — `sendToUser` 스텁으로 전환

## 8. 커밋

1. `멀티 디바이스 토큰 + 재계획 결과 푸시 배선` — 토큰 테이블 분리, sendToUser + 만료 정리, processor 통지
2. `로그아웃 시 FCM 토큰 해제` — DELETE 엔드포인트, removeForUser, 웹 로그아웃 배선
3. `계정 삭제 시 토큰 정리 + 로그인 전 토큰 유실 방지` — removeAllForUser, pending flush
