# TriPick 이메일 로그인 · 세션 · 사용자 핸들 v1

문서 목적: 카카오 OAuth 단독이던 인증에 **이메일 회원가입/로그인 + 이메일 인증 + 비밀번호 재설정**을 더하고, 그 위에 **세션 가드 · refresh 토큰 회전 · 사용자 고유 핸들 · 레이트리밋**을 얹은 작업을 고정한다. 카카오 로그인 v1 위에 얹는 변경이며 디자인 시스템 · FSD · 모듈 경계 규칙은 동일한 흐름으로 정리한다.

기준 브랜치: `feat/email-login-and-session`
작성일: 2026-06-23
후속 문서: [`docs/auth/account-security-hardening-v1.md`](./account-security-hardening-v1.md) — 이 문서가 세운 구조를 전수 검토해 결함 13건을 고쳤다. **아래 3-1·3-2·3-6 은 그 작업으로 동작이 바뀌었으니 후속 문서를 정본으로 본다.**
선행 문서:
- [`docs/settings/settings-profile-v1.md`](../settings/settings-profile-v1.md)
- [`docs/friends/friends-and-trip-members-v1.md`](../friends/friends-and-trip-members-v1.md)

기준 디자인 시스템: [`docs/design-system/toss-v1.md`](../design-system/toss-v1.md)

## 1. 배경 / 문제

기존 인증은 카카오 OAuth 단독이었다. 이메일만으로 가입/로그인하는 동선이 없었고, 클라이언트 세션·토큰 갱신·로그인 가드도 정리되지 않은 상태였다.

| 항목 | 직전 상태 | 문제 |
| --- | --- | --- |
| 가입/로그인 | 카카오 OAuth 만 | 카카오 미사용자 진입 불가 |
| 비밀번호 | 없음 | 이메일 기반 자격 증명 부재 |
| 이메일 인증 | 없음 | 소유 증명 없이 계정 생성 |
| 토큰 갱신 | access 토큰 단발 | 만료 시 재로그인, refresh·로그아웃·폐기 없음 |
| 로그인 가드 | 페이지별 임시 처리 | 비로그인 접근/로그인 후 재접근 일관성 없음 |
| 친구 식별자 | `kakaoId` 를 사실상 핸들로 사용 | 이메일 가입자는 kakaoId 가 없어 식별 불가, nickname·email 매칭은 충돌·PII 노출 |
| 레이트리밋 | 없음 | 로그인 브루트포스 / 메일 발송 남용 무방비 |

해결 방향:
1. **이메일 인증 기반 가입** — 가입 시 비밀번호는 인증 전까지 보류(pending), 인증 메일 클릭으로 활성화.
2. **Refresh 토큰 회전 + reuse detection** — refresh 는 hash 만 DB 저장, 회전·폐기·탈취 탐지.
3. **세션 가드 추상** — 로그인 필수 / 비로그인 전용 가드를 컴포넌트로 통일.
4. **가입 경로 무관 고유 핸들** — 카카오/이메일 상관없이 모든 유저가 갖는 유니크 핸들을 친구 식별의 단일 기준으로.
5. **레이트리밋** — `@nestjs/throttler` + Redis 저장소로 다중 인스턴스에서도 공유.

## 2. 범위

포함:
- 이메일 회원가입/로그인 (`POST /auth/signup`, `/auth/login`)
- 이메일 인증 + 재발송 (`/auth/verify-email`, `/auth/resend-verification`)
- 비밀번호 재설정 요청/확정 (`/auth/forgot-password`, `/auth/reset-password`)
- Refresh 토큰 회전 + reuse detection + 로그아웃 (`/auth/refresh`, `/auth/logout`)
- 이메일 발송 추상 (`EmailService`: console / SMTP 전환)
- 사용자 고유 핸들(`users.handle`) 도입 + 자동 생성 + 백필 + 설정에서 편집
- 친구 추가를 핸들 단일 매칭으로 전환
- 세션 가드 (`SessionGuard` / `GuestGuard`) + 클라이언트 세션 저장/토큰 자동 갱신
- 인증 화면 5종 (signup / login / forgot-password / reset-password / verify-email)
- `@nestjs/throttler` + Redis 저장소 레이트리밋
- 보안 보강: pending 비밀번호, 사용자 enumeration 방지, `/users/me` 민감 필드 차단

제외 / 후속:
- 토큰을 RN 네이티브 SecureStore/Keychain 으로 이전 (현재는 localStorage)
- 소셜 계정 추가 연동 UI (백엔드는 이메일↔카카오 자동 merge 지원)
- 429 응답 한국어 메시지 커스터마이즈
- 이메일 템플릿 디자인 고도화 (현재 인라인 HTML)

## 3. 백엔드

### 3-1. 인증 플로우

`auth/` 모듈에 이메일 기반 동선 추가. 카카오 로그인과 세션 응답 형식(`LoginResponseDto = { tokens, user }`)을 통일. (당시 있던 데모 로그인은 [`docs/auth/account-security-hardening-v1.md`](./account-security-hardening-v1.md) §4.1 에서 제거됐다.)

- **가입** `signupWithEmail` — 이메일/비밀번호/닉네임 검증 후, 비밀번호를 `pendingPasswordHash` 로만 저장하고 인증 메일 발송. ~~이미 비밀번호가 있는 이메일이면 409.~~
  - **변경됨** → [`docs/auth/account-security-hardening-v1.md`](./account-security-hardening-v1.md) §4.2: 이미 있는 계정에는 pending 비밀번호를 심지 않는다(계정 탈취 경로). 안내 메일만 보내고 응답은 신규 가입과 동일 — 409 도 사라졌다.
- **로그인** `loginWithEmail` — bcrypt 비교. 인증 전(pending) 사용자는 `403` + 인증 안내 (401 은 클라에서 "세션 만료" 로 치환되므로 구분).
- **이메일 인증** `verifyEmail` — 토큰 소비 시 `markEmailVerified` 가 인증 처리 + pending 비밀번호 승격을 함께 수행.
- **비밀번호 재설정** — `requestPasswordReset`(enumeration 방지: 항상 동일 응답) → `resetPassword`(토큰 소비 + 비밀번호 확정 + **모든 refresh 토큰 폐기**). 비밀번호가 없는 계정(카카오 단독 가입)도 대상이다 — 기존 계정에 비밀번호를 다는 유일한 경로다.
- 메일 링크 경로는 `/auth/verify-email`, **`/reset-password`**(`/auth/reset-password` 아님).

### 3-2. 토큰 / 세션

- access: `JWT_SECRET` / `JWT_EXPIRES_IN`(7d), refresh: `JWT_REFRESH_SECRET` / `JWT_REFRESH_EXPIRES_IN`(30d).
- `refresh_tokens` 테이블 — raw 토큰의 SHA-256 hash 만 저장. `familyId` 로 회전 체인 추적.
- **회전**: refresh 시 같은 family 로 새 토큰 발급 + 기존 row `replacedAt` 마킹. 마킹은 조건부 UPDATE 로 **선점**하고 진 쪽은 발급하지 않는다([`docs/auth/account-security-hardening-v1.md`](./account-security-hardening-v1.md) §4.5).
- **reuse detection**: 이미 회전된 토큰 재사용 시 family 전체 폐기 (탈취 대응). 단 **30초 유예** 안의 재사용은 경합·재시도로 보고 해당 요청만 거절한다 — 폐기하면 방금 정상 발급된 토큰까지 죽는다.
- refresh payload 에는 `jti` 가 들어간다. 없으면 같은 초에 발급된 두 토큰이 바이트까지 같아져 `tokenHash` 유니크 인덱스에 걸린다.
- 로그아웃 / 비밀번호 변경 시 토큰 폐기.

### 3-3. 이메일 1회용 토큰

- `email_tokens` 테이블 — raw 토큰은 메일 본문에, DB 에는 hash 만. purpose 별(`verify_email` 24h / `reset_password` 1h).
- `consumeEmailToken` 은 `consumedAt IS NULL` 조건부 UPDATE 로 **원자적 소비** (동시 요청 이중 사용 차단).
- `EmailService` — `EMAIL_TRANSPORT=console`(콘솔 출력) / `smtp`(Mailpit·Resend 등) 전환. plain text + HTML 동시 발송.

### 3-4. 사용자 핸들

- `users.handle` 컬럼 (유니크, 소문자) — 가입 경로 무관 고유 식별자.
- 가입 시 자동 생성: 이메일은 local-part, 카카오는 nickname 기반 슬러그 + 충돌 시 숫자 suffix. 비-ASCII(한글 등)는 `user`, `user1` … 폴백.
- `onModuleInit` 에서 핸들 없는 기존 유저 백필.
- `PATCH /users/me { handle }` 로 편집 — `^[a-z0-9_]{3,20}$` 검증 + 중복 차단.
- 친구 추가(`FriendsService.findUserByHandle`)는 **handle 단일 매칭** — 기존 kakaoId·email·nickname 퍼지 매칭 제거(PII enumeration / 동명이인 오매칭 차단).

### 3-5. 레이트리밋

- `@nestjs/throttler` 전역 가드 — 기본 60s/120req per IP.
- 저장소는 **Redis**(`@nest-lab/throttler-storage-redis` + `ioredis`) — BullMQ 와 같은 Redis, 다중 인스턴스에서 카운트 공유.
- `HttpThrottlerGuard` 로 래핑 — WebSocket 등 비-HTTP 컨텍스트는 통과(기본 가드가 express req/res 가정해 깨지는 문제 회피).
- auth 라우트별 강한 제한(`@Throttle`, 분당): 로그인 10 / 가입 5 / 메일 재발송·비번재설정 메일 3 / 이메일 인증 20 / 비번 재설정 10.
- `main.ts` `trust proxy` — nginx 뒤에서 `X-Forwarded-For` 실제 IP 를 레이트리밋 키로 사용.

### 3-6. 보안 보강

| 항목 | 처리 |
| --- | --- |
| 미인증 비밀번호 활성화 (계정 탈취) | 가입 비밀번호는 `pendingPasswordHash` → 이메일 인증 시에만 승격. **기존 계정에는 심지 않는다**(hardening 문서 §4.2) |
| 사용자 enumeration | forgot-password / resend-verification / **signup** 항상 동일 응답 |
| `/users/me` 민감 필드 노출 | `publicProfile()` 로 `passwordHash` · `pendingPasswordHash` · `fcmToken` 제거 후 반환 |
| 토큰 이중 소비 | email 토큰 조건부 UPDATE |
| refresh 탈취 | reuse detection → family 폐기 |

## 4. 프론트엔드 (FSD)

### 4-1. 화면 / 라우트

- `app/signup`, `app/login`, `app/forgot-password`, `app/reset-password`, `app/auth/verify-email` — 각 view 로 위임.
- view: `views/signup`, `views/login`, `views/forgot-password`, `views/reset-password`, `views/verify-email`.

### 4-2. feature

- `features/email-signup`, `features/email-login`, `features/request-password-reset`, `features/reset-password` — 각 폼 + mutation(`@tanstack/react-query`).
- `features/edit-handle` — 프로필 핸들 인라인 편집(UI 문구는 "아이디 / @").

### 4-3. entities / shared

- `entities/session` — 세션 저장(`session-storage`), 가드 훅(`useSessionGuard` / `useGuestGuard`), 가드 컴포넌트(`SessionGuard` / `GuestGuard`).
- `shared/lib/session-token` — 세션 키 + 토큰 read/write/clear 단일 소스. `shared/api/client` 와 `entities/session` 이 함께 참조(키/구조 drift 제거).
- `shared/api/client` — 401 시 refresh 1회 자동 재시도(다발 호출은 공유 Promise 로 1회 합침). `/auth/*` 의 401 은 서버 메시지 그대로 노출(세션 만료 안내로 치환 안 함).
- `shared/ui/InlineEditableText` — 표시/편집 엘리먼트를 교체하지 않고 항상 input 유지 → **레이아웃 시프트 없는** 인라인 편집(닉네임·핸들 공용). 숨김 sizer 로 내용 폭, 포커스 시 테두리/ring 만 변화, `size={1}` 로 input 내재 너비 무력화.

### 4-4. 토큰 저장 위치 (결정)

- 현재 access/refresh 모두 localStorage. sessionStorage 는 XSS 위협 모델이 동일(보안 이득 없음)하고 수명만 짧아져 WebView UX 악화 → 채택 안 함.
- 더 안전한 방향(access 는 메모리, refresh 는 httpOnly 쿠키 / 네이티브 SecureStore)은 RN WebView 브리지 복잡도로 **후속**. reuse detection + 회전으로 최악은 완화.
- **갱신(2026-07-23)**: RN 은 refresh 토큰을 네이티브 SecureStore(Keychain/Keystore)로 이전 완료 → [refresh-token-securestore-v1.md](refresh-token-securestore-v1.md). access 메모리화는 여전히 후속.

## 5. 데이터 모델 변경

- `users`: `passwordHash`(인증 후), `pendingPasswordHash`(인증 대기), `emailVerifiedAt`, `handle`(유니크) 추가.
- `refresh_tokens`: id / userId / tokenHash(uniq) / familyId / expiresAt / replacedAt / revokedAt / userAgent / ipAddress.
- `email_tokens`: id / userId / purpose / tokenHash(uniq) / expiresAt / consumedAt.
- 개발 환경 `synchronize: true` 기준 — 컬럼/테이블 자동 반영. 라이브는 마이그레이션 필요.

## 6. 환경변수

```
# JWT
JWT_SECRET=...
JWT_EXPIRES_IN=7d
JWT_REFRESH_SECRET=...
JWT_REFRESH_EXPIRES_IN=30d

# Web (이메일 링크 base)
WEB_APP_URL=http://localhost:3000

# Redis (레이트리밋 저장소 + BullMQ 공용)
REDIS_HOST=localhost
REDIS_PORT=6379

# Email
EMAIL_TRANSPORT=console        # console | smtp
EMAIL_FROM=TriPick <noreply@tripick.place>
SMTP_HOST=localhost
SMTP_PORT=1025                 # 로컬 Mailpit
SMTP_USER=
SMTP_PASS=
SMTP_SECURE=false
```

## 7. 후속 / TODO

- ~~refresh 토큰을 RN 네이티브 SecureStore 로 이전, access 만 WebView 주입.~~ → 완료: [refresh-token-securestore-v1.md](refresh-token-securestore-v1.md)
- ~~이 구조 전반의 보안 결함 점검.~~ → 완료: [`docs/auth/account-security-hardening-v1.md`](./account-security-hardening-v1.md) (13건 수정, 남은 항목은 그 문서 §7)
- 429 응답 한국어 메시지 + 재시도 안내 UI.
- 이메일 인증/재설정 메일 템플릿 디자인 정리.
- 핸들 기반 친구 초대 링크 / QR (이번 핸들 위에 얹기).
