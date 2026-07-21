# 웹 푸시 (Service Worker + VAPID) v1

문서 목적: RN 컨테이너 밖 브라우저 단독 사용자도 FCM 푸시를 수신하도록, 웹 앱에 서비스 워커 + VAPID 토큰 발급을 붙인 작업을 고정한다. 백엔드 발송 인프라는 이미 멀티 디바이스 토큰(`fcm_tokens`)으로 준비돼 있어 손대지 않고, 웹이 발급한 토큰만 기존 등록 경로에 태운다.

기준 브랜치: `feat/web-push-service-worker`
작성일: 2026-07-21
관련 문서: [`docs/notification/fcm-production-push-v1.md`](./fcm-production-push-v1.md) (멀티 토큰 테이블·발송·토큰 생명주기 — 이 문서가 그 위에 웹 채널을 추가), [`docs/notification/inbox-and-trip-invite-v1.md`](./inbox-and-trip-invite-v1.md) (backlog "Web Push (Service Worker + VAPID)" 항목), [`docs/notification/friend-request-push-and-deeplink-v1.md`](./friend-request-push-and-deeplink-v1.md) (푸시 탭 딥링크 라우팅 규칙 공유)

## 1. 범위

포함:

- 웹 FCM 토큰 발급 — `firebase` 웹 SDK + VAPID 공개키로 `getToken`, 브라우저 단독 진입 사용자 대상
- 서비스 워커(`public/firebase-messaging-sw.js`) — 백그라운드 수신 + 알림 클릭 라우팅
- 발급 토큰을 기존 `PATCH /users/me/fcm-token`(platform=`web`)으로 등록, 로그인 전이면 pending 보관 후 flush
- 포그라운드 수신 → 인박스 invalidate, SW 알림 클릭 → 인박스 invalidate + 해당 화면 라우팅
- 활성 조건 가드 — RN WebView 내부·env 미설정·SW/Notification 미지원 브라우저는 no-op

제외 (별도 backlog):

- 백엔드 발송/토큰 저장 — [`fcm-production-push-v1`](./fcm-production-push-v1.md)에서 완료(멀티 토큰 + platform 컬럼), 변경 없음
- 알림 권한 옵트인 UI — 현재 마운트 시 자동 프롬프트. 설정 토글/제스처 기반 opt-in은 후속
- 디바이스별 푸시 토큰 관리 UI — 백엔드 `fcm_tokens`는 준비, 목록/해제 화면은 별도 backlog

## 2. 왜 프론트 작업만인가

백엔드는 웹 토큰을 이미 그대로 받는다. `fcm_tokens`는 사용자 1 : 토큰 N 이고 `platform` 컬럼이 있으며, `NotificationService.sendToUser`가 플랫폼 구분 없이 토큰별로 fan-out 한다. 즉 웹이 발급한 FCM 토큰이 같은 테이블에 등록되기만 하면 발송·만료 정리·로그아웃 해제 흐름이 그대로 재사용된다. 그래서 이 작업은 **웹에서 토큰을 발급해 기존 등록 경로에 태우는 것**으로 좁혀진다.

## 3. 구성

```
apps/web/
├── public/firebase-messaging-sw.js        # 백그라운드 수신 + 알림 클릭 라우팅
└── src/shared/web-push/
    ├── config.ts        # NEXT_PUBLIC_FIREBASE_* env, isWebPushConfigured, SW 등록 URL
    ├── messaging.ts     # 지원 가드, VAPID 토큰 발급, 포그라운드 onMessage
    ├── use-web-push.ts  # 토큰 등록/pending, 포그라운드·클릭 배선(훅)
    ├── web-push.tsx     # 훅 마운트용 무렌더 컴포넌트(RnBridge 대칭)
    ├── route.ts         # 푸시 payload → 경로 규칙(rn-bridge와 공유)
    └── index.ts
```

- `<WebPush />`는 [`app/providers.tsx`](../../apps/web/src/app/providers.tsx)에서 `<RnBridge />` 옆에 마운트.
- 라우팅 규칙은 `route.ts` 하나로 단일화해 rn-bridge가 공유. 서비스 워커만 앱 코드를 import 할 수 없어 같은 규칙을 불가피하게 복제(양쪽 주석 명시).

## 4. 데이터 흐름

### 토큰 발급 → 등록

```
① <WebPush /> 마운트 (RN WebView 밖 + env 설정 + 지원 브라우저일 때만)
→ ② 알림 권한 요청(denied면 중단)
→ ③ SW 등록(설정을 쿼리스트링으로 주입) → activated 대기
→ ④ getToken(vapidKey, swRegistration)
→ ⑤ 세션 있으면 PATCH /users/me/fcm-token (platform='web'), 없으면 pending 보관
      → 로그인 완료 시 flushPendingFcmToken 이 등록
```

### 수신

- **포그라운드**(탭 열림): OS 알림 미표시 → `onMessage` 콜백이 인박스 invalidate.
- **백그라운드**(탭 닫힘/비활성): SW `onBackgroundMessage`가 `showNotification`으로 표시.
- **알림 클릭**: SW `notificationclick` → 열린 탭 있으면 포커스·라우팅(`NOTIFICATION_TAP` 메시지), 없으면 새 창. 경로는 `tripId` 있으면 `/planner?tripId=…`, 없으면 `/inbox`.

## 5. 결정과 근거

1. **서비스 워커 설정은 등록 URL 쿼리스트링으로 주입.** SW는 빌드 타임 `process.env`를 못 읽으므로, 메인 스레드가 `register('/firebase-messaging-sw.js?apiKey=…')`로 넘기고 SW가 `location.search`로 읽는다. 값은 모두 공개 클라이언트 식별자라 노출돼도 안전(실제 발송 권한은 백엔드 서비스 계정 키).
2. **compat SDK는 CDN `importScripts`로 로드.** SW 안에서 npm 번들을 쓰기 번거로워, `gstatic` compat 빌드를 불러온다. npm `firebase` 버전과 독립.
3. **`getToken` 전에 SW `activated` 대기.** `register()` 직후 워커는 `installing`일 수 있는데 `getToken`은 PushManager 구독에 active 워커를 요구한다(→ `no active Service Worker`). `statechange`로 활성까지 기다리며, 리스너 부착 직전 활성화되는 레이스도 즉시 재확인으로 방어.
4. **RN WebView 내부에선 no-op.** 네이티브가 FCM을 잡으므로 웹이 또 발급하면 토큰이 이중 등록된다. `getReactNativeWebView()`로 차단.
5. **pending/last 토큰 저장소를 RN과 공유.** 로그인 전 유실 방지(pending flush)와 로그아웃 해제(`deleteFcmToken(lastToken)`) 흐름을 웹이 그대로 재사용 — 별도 배선 불필요.
6. **env 하나라도 비면 초기화 자체를 스킵.** `isWebPushConfigured()`가 false면 no-op이라, 자격 미설정 환경에서 조용히 비활성.

## 6. 설정

`apps/web/.env`(또는 `.env.local`)에 Firebase 웹 앱 설정 + VAPID 공개키:

```
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_FIREBASE_VAPID_KEY=   # 콘솔 > 클라우드 메시징 > 웹 푸시 인증서(공개 키)
```

VAPID 키는 웹 푸시 전용 공개키로, Firebase 콘솔 **프로젝트 설정 > 클라우드 메시징 > 웹 푸시 인증서**에서 키 쌍을 생성해 얻는다. `localhost`는 secure context 예외라 로컬 HTTPS 없이 동작한다.

## 7. 검증

```bash
pnpm --filter @tripick/web typecheck
pnpm --filter @tripick/web build
```

자동 확인:
- SW 엔드포인트 `GET /firebase-messaging-sw.js` → 200, `Content-Type: application/javascript` (MIME 틀리면 브라우저가 SW 거부)
- compat CDN(`firebase-app-compat.js`/`firebase-messaging-compat.js`) 도달 200

수동 확인:
1. 브라우저 단독으로 접속 → 로그인 → 알림 권한 **허용**
2. DevTools → Application → Service Workers 에 `firebase-messaging-sw.js` **activated**
3. Network 탭 `PATCH /users/me/fcm-token` payload의 `fcmToken` 확인(= 이 브라우저 토큰)
4. Firebase 콘솔 **클라우드 메시징 > 테스트 메시지 보내기**에 토큰 입력 → 탭 백그라운드면 OS 알림, 포그라운드면 인박스 invalidate
5. 알림 클릭 → `tripId` 유무에 따라 `/planner?tripId=…` 또는 `/inbox` 라우팅
6. 로그아웃 시 `DELETE /users/me/fcm-token` 발신(토큰 해제)

## 8. 후속 작업 (backlog)

- **권한 옵트인 UI** — 현재 마운트 시 자동 프롬프트. 설정 토글/제스처 기반 opt-in으로 전환.
- **`platform='web'` 정밀 태깅** — 비로그인 방문 → 로그인 경로는 공유 `flushPendingFcmToken`이 platform 없이 등록. 디바이스 관리 UI 도입 시 pending에 platform 동반 저장 필요.
- **같은 탭 재로그인(다른 계정)** — 리로드 없이 계정 전환 시 새 사용자 토큰 미재등록(기존 RN 공유 저장소 한계). 필요 시 세션 변경 감지로 재발급.
- **디바이스별 푸시 토큰 관리 UI** — 백엔드 `fcm_tokens` 완료, 목록/해제 화면만 남음.

## 9. 결정 요약

1. 백엔드 무변경 — 웹 토큰은 기존 멀티 디바이스 `fcm_tokens` + `sendToUser` fan-out을 그대로 탄다.
2. 서비스 워커 설정은 등록 URL 쿼리로 주입(SW는 빌드 env를 못 읽음), compat SDK는 CDN import.
3. `getToken` 전 워커 `activated` 대기로 `no active Service Worker` 해소(레이스 방어 포함).
4. RN WebView 내부·env 미설정·미지원 브라우저는 no-op — 토큰 이중 등록·미설정 환경 오작동 차단.
5. pending/last 토큰 저장소를 RN과 공유해 로그인 전 유실·로그아웃 해제 흐름을 재사용.
6. 라우팅 규칙은 `route.ts`로 단일화(SW만 불가피 복제).
