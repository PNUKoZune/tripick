# TriPick refresh 토큰 RN SecureStore 이전 v1

문서 목적: WebView localStorage 에 함께 두던 **refresh 토큰**을 RN 네이티브 보안 저장소(iOS Keychain / Android Keystore)로 옮기고, WebView 에는 **access 토큰만** 남기는 작업을 고정한다. [email-login-and-session-v1](email-login-and-session-v1.md) §4-4 에서 "후속"으로 미뤄 둔 항목의 실구현이다.

기준 브랜치: `feat/refresh-token-securestore`
작성일: 2026-07-23
선행 문서:
- [`docs/auth/email-login-and-session-v1.md`](email-login-and-session-v1.md) (§4-4 토큰 저장 위치 결정, §7 TODO)
- [`docs/setup/mobile-webview-setup.md`](../setup/mobile-webview-setup.md) (RN WebView 셸 · 브리지)

---

## 1. 배경 / 문제

- 기존엔 access·refresh 를 한 세션 blob(`tripick.session.v1`)으로 **localStorage 에 함께 영속**했다. RN 앱은 이 웹앱을 WebView 로 띄우므로 refresh 토큰이 WebView localStorage 에 그대로 남는다.
- WebView localStorage 는 검사·탈취 노출면이 넓다. 장수(長壽) 자격증명인 refresh 토큰을 여기에 영속하는 것은 access(7일 TTL)보다 위험 대비 손실이 크다.
- 목표: **refresh 토큰을 localStorage 에 영속하지 않는다.** RN 에선 네이티브 SecureStore 에만 두고, 브라우저 단독 경로는 기존 그대로 둔다.

## 2. 범위

- **포함**: RN 웹뷰에서 refresh 토큰의 저장·조회·삭제를 네이티브 SecureStore 로 위임. 로그인·토큰 회전·로그아웃·자동 refresh(401) 경로 mode 분기. 구버전 localStorage refresh 의 1회성 이관.
- **제외**: access 토큰 저장 위치(계속 localStorage — item 범위 밖). 서버 refresh 회전 로직(무변경). 브라우저 단독 동작(무변경).

## 3. 설계 결정

### 3-1. 역할 분담 — 네이티브 = 순수 SecureStore, 웹 = 모든 auth HTTP

- refresh 발급/회전/폐기 HTTP 는 **전부 웹이 담당**하고, 네이티브는 값의 **저장·조회·삭제만** 맡는다.
- 근거: 대안(네이티브가 `/auth/refresh` 를 직접 수행)은 로그인 시 어차피 refresh 가 웹에 한 번 노출되므로 보안 이득이 미미한데, 네이티브 HTTP·응답 파싱 로직이 늘어 오류면만 커진다. auth 로직을 웹 한 곳에 모아 단일 진실원천을 유지하고 브라우저에서 그대로 테스트 가능하게 했다.
- 결과적으로 refresh 토큰은 (a) 로그인·회전 시 JS 메모리에 잠깐, (b) 네이티브 Keychain/Keystore 에 영속 — 이 둘에만 존재하고 **localStorage 에는 절대 남지 않는다.**

### 3-2. 브리지 프로토콜 (postMessage)

단방향 postMessage 위에 요청-응답을 얹는다.

| 방향 | 메시지 | 용도 |
| --- | --- | --- |
| web → native | `STORE_REFRESH_TOKEN { token }` | 로그인·회전 시 저장 |
| web → native | `CLEAR_REFRESH_TOKEN` | 로그아웃·탈퇴 시 삭제 |
| web → native | `REQUEST_REFRESH_TOKEN { requestId }` | 조회 요청 |
| native → web | `REFRESH_TOKEN { requestId, token }` | 조회 응답(없으면 `token: null`) |

### 3-3. 견고성 (코드 리뷰 반영)

초기 구현의 타이밍·동시성 취약점을 다음으로 고정했다.

- **응답 리스너를 모듈 로드 시점에 등록**한다(React mount 타이밍 무관). `native-refresh-token.ts` 가 import 되는 즉시 `window.addEventListener('message', …)` 를 붙여, 부팅 직후 refresh 요청이 리스너보다 먼저 나가도 응답이 유실되지 않는다.
- **correlation id 기반 다중 pending Map**. refresh·logout 이 동시에 물어도 서로의 응답을 뺏거나 오배정하지 않는다. `REQUEST_REFRESH_TOKEN` 의 `requestId` 를 네이티브가 그대로 실어 돌려준다.
- **타임아웃(`undefined`)과 토큰 확정 부재(`null`) 구분**. 8초 무응답(브리지 순단)은 "판정 불가"라 세션을 지우지 않고, 네이티브가 확정한 "토큰 없음"(`null`)만 세션 정리 대상으로 본다. 순간 부하로 정상 세션이 만료 처리되던 문제를 막는다.

## 4. 구현

### 4-1. 웹 (FSD)

- `shared/rn-bridge/native-refresh-token.ts` (신규) — 브리지 seam. `isNativeShell()` / `storeNativeRefreshToken` / `clearNativeRefreshToken` / `requestNativeRefreshToken()`(correlation id·타임아웃) + 모듈 로드 시 응답 리스너.
- `shared/lib/session-token.ts` — `persistSession()`: RN 이면 refresh 를 네이티브로 넘기고 localStorage 엔 access 만(refresh 는 빈 문자열). `replaceTokens`·`clearStoredSession` 도 mode-aware. `getRefreshToken()` 은 `|| null`(빈 문자열도 null).
- `shared/api/client.ts` — 401 자동 refresh 가 RN 에선 네이티브에서 refresh 를 가져와 `/auth/refresh` 호출. 브라우저 경로 무변경.
- `entities/session/model/session-storage.ts` — `storeSession` 이 `persistSession` 위임.
- `entities/session/api/auth-api.ts` — `logout` 은 RN 에서 네이티브 refresh 를 가져와 서버 폐기 요청. `refreshTokens` 는 `undefined`(순단)면 세션 보존, `null`이면 정리.
- `shared/rn-bridge/rn-bridge.tsx` — 마운트 시 **업그레이드 이관**(구버전 localStorage refresh → SecureStore 이전 후 제거).
- `shared/web-push/messaging.ts`·`features/report-live-location/…` — 순수 불리언 판정부를 `isNativeShell()` 로 통일.

### 4-2. 모바일 (RN 셸)

- `apps/mobile/package.json` — `react-native-keychain ^10.0.0` 추가.
- `apps/mobile/src/App.tsx` — `STORE`/`CLEAR`/`REQUEST_REFRESH_TOKEN` 브리지 핸들러. 저장 접근성 `AFTER_FIRST_UNLOCK`(잠금 해제 후 백그라운드 조회 가능, 생체 프롬프트 없음). 서비스 키 `place.tripick.refreshToken`. `REQUEST` 응답에 `requestId` 왕복.

## 5. 검증

- 웹 `tsc --noEmit` **통과**.
- 모바일 `tsc` 는 `react-native-keychain` 미설치 파생 에러(모듈 미해결 + 그로 인한 implicit-any 3건)만 — **설치 후 해소**되는 것 확인. 독립 타입 에러 없음.
- 브라우저 단독 경로는 `isNativeShell()` false 로 기존과 동일 동작.

### 남은 조치 (네이티브 rebuild 필요)

WSL2 에선 실기기 검증이 어려워 아래는 실기 환경에서 필요:

1. `pnpm install` (keychain 설치)
2. iOS `pod install`, Android autolinking (WSL 이면 autolinking 캐시 주의)
3. 에뮬레이터/기기: 로그인 → 앱 재시작 → 세션 유지 + 로그아웃 시 Keychain 삭제 + 구버전 localStorage refresh 이관 확인

## 6. 후속

- access 토큰 저장 위치(메모리화) 검토 — 별도 항목.
