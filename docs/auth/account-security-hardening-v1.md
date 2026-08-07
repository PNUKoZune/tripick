# 회원 도메인 보안 보강 v1

문서 목적: 회원가입·로그인·회원 관리 전체를 훑어 나온 결함 13건을 고친 작업을 고정한다. 기능 추가가 아니라 **이미 있던 동선의 구멍을 막는 작업**이라, 각 항목이 어떤 공격·장애로 이어졌는지와 왜 그 방식으로 막았는지를 남긴다. 검토 대상은 [`docs/auth/email-login-and-session-v1.md`](./email-login-and-session-v1.md) 가 세운 인증 구조 전체 + `users` 모듈.

기준 브랜치: `fix/auth-review-followups` (base: `develop`)
작성일: 2026-08-07
선행 문서: [`docs/auth/email-login-and-session-v1.md`](./email-login-and-session-v1.md) (이 작업이 고치는 대상), [`docs/auth/refresh-token-securestore-v1.md`](./refresh-token-securestore-v1.md) (refresh 저장 위치)
관련 컨텍스트: [`CLAUDE.md`](../../CLAUDE.md) §4 모듈 경계, §6 카카오 OAuth

## 1. 범위

포함:

- 비밀번호 재설정 메일 링크 경로 정정(플로우 전체가 죽어 있었음)
- 응답에서 비밀번호 해시 제거(프로필 이미지 엔드포인트 누락분)
- JWT 시크릿 기본값 폴백 제거 + 프로덕션 fail-fast
- 공유 데모 세션(`POST /auth/demo`) 제거 및 그 위에 얹혀 있던 UI·도구 정리
- 카카오 OAuth `state`(로그인 CSRF) + 시작 URL 오리진 정합
- 카카오 로그인 결과를 URL 프래그먼트 세션 → 1회용 교환 코드로 전환
- 기존 계정에 비밀번호를 심는 가입 경로 차단 + 가입 응답 enumeration 제거
- refresh 회전 원자화 + 경합/재시도 유예 + refresh 토큰 `jti`
- `/auth/*`·`/users/me` DTO 클래스화(전역 ValidationPipe 실동작)
- 알림 설정 jsonb 키·값 제한, `profileImageUrl` 임의 지정 차단
- 동시 가입 유니크 충돌 500 제거, 로그인 타이밍 차 제거

제외 / 후속:

- **access 토큰 무효화** — 로그아웃은 여전히 refresh 만 폐기한다(§7)
- **`isDemo` 컬럼 제거** — 데모 계정을 일반 계정으로 운영하기로 해서 표시용으로 남겼다(§4.1)
- 이메일 주소 기준 발송 제한(현재 IP 기준만), 핸들 백필의 마이그레이션 이전 — §7

## 2. 배경 — 검토에서 나온 것

| # | 항목 | 실제 영향 |
| --- | --- | --- |
| 1 | 재설정 메일 링크가 `/auth/reset-password` (웹 라우트는 `/reset-password`) | 비밀번호 재설정 **전체가 404**. 도입 시점부터 계속 |
| 2 | 프로필 이미지 업로드·삭제 응답이 `UserEntity` 원본 | bcrypt `passwordHash`·`pendingPasswordHash` 가 클라이언트로 나감 |
| 3 | `JWT_SECRET` 등 4곳에 공개 기본값 폴백 | env 하나 빠지면 레포에 적힌 문자열로 서명 → 임의 userId 토큰 위조 |
| 4 | `POST /auth/demo` 무인증 + 계정 1개 공유 | 모든 방문자가 같은 계정 → 서로의 여행·사진·위치가 그대로 보임 |
| 5 | 카카오 OAuth `state` 없음 | 공격자 인가 코드로 피해자를 **공격자 계정에 로그인**시키는 CSRF |
| 6 | 기존 계정에 pending 비밀번호를 심고 인증 링크로 승격 | 링크는 계정 주인에게 간다 → 주인이 누르면 공격자 비밀번호 활성화 = 계정 탈취 |
| 7 | refresh 회전이 검사·발급·마킹 3단계 비원자 | 한 토큰에서 두 벌 발급. 재시도를 탈취로 오인해 family 폐기 → 정상 세션 사망 |
| 8 | 세션(refresh 포함)을 리다이렉트 프래그먼트에 실음 | 30일짜리 자격증명이 브라우저 히스토리에 남음 |
| 9 | `/auth/*` DTO 가 인터페이스 | 전역 ValidationPipe 가 **전혀 동작하지 않음**(타입·모르는 필드 무검사) |
| 10 | 알림 설정이 임의 JSON 을 jsonb 에 저장 | 사용자 행에 아무 키·값이나 영구 적재 |
| 11 | `PATCH /users/me { profileImageUrl }` | 전용 업로드가 있는데도 임의 외부 URL 을 프로필 사진에 앉힘 |
| 12 | 동시 가입 유니크 충돌 미처리 | 500 |
| 13 | 없는 계정 로그인이 bcrypt 를 건너뜀 | 응답 시간차로 가입 여부 조회 |

작업 중 **추가로 드러난 것 2건**(§4.5, §4.3)이 있는데, 둘 다 위 수정을 검증하다 나왔고 성격상 원래 항목과 붙어 있어 같이 고쳤다.

## 3. 데이터 흐름 — 카카오 로그인 (변경 후)

```
① 웹: GET /auth/kakao/status → { ready, startUrl }      ← startUrl 은 API 오리진 절대 URL
→ ② 브라우저가 startUrl 로 이동 (API 오리진)
   서버: state 발급 → httpOnly·SameSite=Lax 쿠키(path=/api/v1/auth, 10분) + authorize URL 의 state
→ ③ 카카오 인증 → KAKAO_CALLBACK_URL 로 복귀 (같은 API 오리진 → 쿠키 실림)
→ ④ 서버: 쿠키 state 와 쿼리 state 대조(timingSafeEqual). 불일치·부재면 코드 교환 전에 차단
→ ⑤ 카카오 토큰·프로필 조회 → 세션 생성 → Redis 에 1회용 코드로 보관(120s)
→ ⑥ 웹 콜백 화면으로 리다이렉트, URL 에는 #code=... 만
→ ⑦ 웹: history.replaceState 로 코드 지운 뒤 POST /auth/kakao/exchange → 세션 수령(코드 소비)
```

②와 ③이 **같은 오리진**이어야 하는 게 핵심이다 — §4.3.

## 4. 설계 판단

### 4.1 데모 세션은 없애고, 데모 계정은 일반 계정으로

`POST /auth/demo` 는 `kakaoId='demo-user'` 행 하나를 자동 생성하고 **인증 없이** 그 계정의 세션을 내줬다. 랜딩의 primary CTA("임시 세션으로 둘러보기")가 이걸 불렀으니, 둘러본 모든 방문자가 한 계정을 공유하며 서로의 여행·업로드 사진·위치 기록을 봤다.

방문자별 임시 계정을 만드는 선택지도 있었지만, 데모용 계정을 그냥 일반 계정으로 운영하기로 했다. 결과적으로 지워진 것:

- 엔드포인트·서비스: `loginDemo`, `findOrCreateDemoUser`, `DemoLoginDto`
- 웹: `startDemoSession`, 랜딩 CTA, 카카오 콜백 실패 화면의 폴백 버튼
- 취향 화면이 세션 없을 때 **조용히 임시 세션을 만들어 붙이던 5개 경로** — 남의 계정에 내 사진·취향이 쌓이던 자리다. `requireSession()` 으로 바꿔, 세션이 없으면 넘어가지 않고 멈춘다(이 화면은 `SessionGuard` 안이라 정상 경로면 항상 있다)

`isDemo` 컬럼과 설정 화면의 "데모 계정" 배지는 **남겼다**. 운영할 데모 계정에 이 값만 켜면 배지가 그대로 동작해서, 지우는 것보다 쓸모가 있다.

도구 체인도 같이 옮겼다 — `seed:demo-live` 는 `SEED_USER_EMAIL` 로 대상 계정을 지정하고, e2e 스펙과 `run-tripick` 드라이버는 실제 가입/로그인 경로를 탄다.

### 4.2 기존 계정에는 비밀번호를 심지 않는다

원래 설계는 "가입 시 비밀번호를 `pendingPasswordHash` 로만 저장하고 이메일 인증 링크로 승격 → 소유 증명 없이는 활성화 안 됨"이었다. 신규 가입에는 맞지만 **이미 있는 계정**에 적용하면 뒤집힌다. 그 인증 메일은 계정 주인에게 가고, 문구는 "가입해주셔서 감사합니다 / 이메일 인증하기"다. 주인이 자기 계정 관련 메일로 알고 누르면 공격자가 넣은 비밀번호가 켜진다.

그래서 기존 계정이면 **아무것도 바꾸지 않고** 주인에게 상황만 알리는 메일(`sendAccountExistsNotice`)을 보낸다. 누를 CTA 는 "비밀번호 재설정"이고, 계정·비밀번호는 그대로라는 걸 명시한다.

이 변경의 파생 효과 두 가지:

- **가입 응답이 신규/기존 구분 없이 완전히 같아진다.** 기존엔 비밀번호 있는 계정에 409 를 던져 가입 여부가 그대로 샜다. 이제 두 갈래가 같은 `signupResult(email)` 을 낸다 — 응답이 갈리면 그 자체가 가입 여부 조회 API 다
- **기존 계정에 비밀번호를 다는 유일한 경로가 재설정 플로우가 된다.** 그런데 `requestPasswordReset` 이 `passwordHash` 있는 계정만 통과시키고 있어서, 그대로 두면 카카오 단독 가입자는 이메일 로그인을 영영 못 쓴다. 조건을 풀었다(응답은 어차피 동일해서 enumeration 은 그대로 막혀 있다)

`pendingPasswordHash` 는 이제 **신규 가입 시점에만** 채워지고 이후 덮어써지지 않는다. 그래서 "공격자가 재-가입해 남의 대기 비밀번호를 바꿔치기"도 함께 닫힌다.

### 4.3 카카오 `state` 는 시작·콜백 오리진이 같아야 의미가 있다

`state` 를 authorize URL 에만 실으면 방어가 안 된다 — 공격자가 자기 흐름을 시작해 유효한 state 를 얻은 뒤 피해자에게 던지면 그만이다. 그래서 같은 값을 httpOnly 쿠키로 심어 **브라우저에 묶고** 콜백에서 대조한다.

여기서 걸린 게 오리진이다. 웹은 `NEXT_PUBLIC_API_URL=/api/v1` 상대경로를 써서 Next rewrite 프록시를 타는데, 그러면 시작 요청이 **웹 오리진**에서 나가 쿠키도 거기 붙는다. 반면 카카오는 `KAKAO_CALLBACK_URL`(**API 오리진**)로 돌려보낸다. 로컬은 쿠키가 포트를 무시해 우연히 통과하지만, 배포(웹=Vercel / API=별도 호스트)에서는 호스트가 달라 쿠키가 안 실리고 **로그인이 항상 실패**한다.

이미 등록된 `KAKAO_CALLBACK_URL` 에서 `/callback` 만 떼면 그게 시작 URL 이라, 서버가 계산해 `startUrl` 로 내려주고 웹은 그 절대 URL 로 이동한다. 새 환경변수 없이 두 다리의 오리진이 항상 맞는다. 클라이언트가 쓰지 않던 `KakaoAuthStatusDto.authorizeUrl` 은 state 없는 URL 이라 제거했다.

### 4.4 카카오 세션은 1회용 코드 뒤에 숨긴다

기존엔 `{tokens, user}` 를 통째로 base64 로 만들어 리다이렉트 프래그먼트에 실었다. 프래그먼트는 서버로 가지 않지만 브라우저 히스토리·확장 프로그램·화면 공유에는 남고, 거기 30일짜리 refresh 토큰이 들어 있었다.

이제 세션은 Redis 에 두고 URL 에는 120초짜리 랜덤 코드만 싣는다. 웹이 `POST /auth/kakao/exchange` 로 바꿔 가며, `GETDEL` 이라 두 번째 교환은 실패한다. 쿼리 대신 프래그먼트를 유지한 건 Referer·서버 로그에 아예 안 실리기 때문이다.

저장소로 Redis 를 고른 이유: 코드를 발급한 인스턴스와 교환을 받는 인스턴스가 다를 수 있다. Redis 연결 실패가 부팅을 막지는 않게 했다 — 이메일 로그인은 Redis 없이도 돌아야 한다.

### 4.5 refresh 회전 — 원자적 선점 + 경합 유예 + `jti`

세 가지가 얽혀 있다.

**(a) 비원자 회전.** 검사 → 발급 → `replacedAt` 마킹 사이에 다른 요청이 끼면 한 토큰에서 두 벌이 나오고, 한 벌은 주인 없이 30일을 산다. 조건부 UPDATE(`WHERE id=? AND replacedAt IS NULL AND revokedAt IS NULL`)의 `affected` 로 승자를 가리고 진 쪽은 발급하지 않는다.

**(b) 재시도를 탈취로 오인.** 기존 reuse detection 은 이미 회전된 토큰을 다시 쓰면 무조건 family 를 폐기했다. 그런데 응답을 놓친 클라이언트의 재시도, 웹·네이티브 동시 갱신이 정확히 그 모양이다. 폐기하면 **직전에 정상 발급된 새 토큰까지** 죽어 멀쩡한 세션이 날아간다. 30초 유예 안의 재사용은 경합으로 보고 해당 요청만 401 로 거절하고, 그보다 오래된 재사용만 탈취로 다룬다.

**(c) refresh 토큰이 유일하지 않았다.** (a) 를 검증하다 500 이 떴다 — `tokenHash` 유니크 인덱스 위반. payload 가 `{sub}` 뿐이라 `iat`(초 단위)만 같으면 **토큰이 바이트까지 동일**해진다. 로그인 직후 같은 초에 갱신하면 재현된다(로그인끼리는 bcrypt cost 12 가 초를 벌려 줘서 잘 안 터진다). 원래도 있던 버그인데 (a) 를 넣으면서 "row 는 선점됐는데 발급은 실패" = 세션 사망으로 악화돼, `jti` 를 추가해 매 발급을 유일하게 만들었다.

### 4.6 시크릿 폴백은 프로덕션에서 부팅을 막는다

`config.get('JWT_SECRET') ?? 'tripick-demo-jwt-secret'` 가 4곳(AuthModule·JwtStrategy·AuthService refresh·**RealtimeModule**)에 흩어져 있었다. RealtimeModule 을 놓치면 HTTP 만 막고 WebSocket 게이트웨이는 열려 있게 되므로, 한 곳(`common/jwt-secrets`)으로 모았다.

프로덕션에서는 키가 없을 때뿐 아니라 **`.env.example` 의 placeholder 값**(`change-me-in-production` 등)도 거부한다 — "env 는 설정했는데 값이 예시 그대로"가 실제로 더 흔하다. refresh 키는 런타임마다 읽던 것을 생성자에서 확정해 access 키와 같이 부팅 시점에 죽게 했다.

### 4.7 DTO 를 클래스로 — 파이프가 실제로 돌게

`packages/types` 는 FE·BE 공유용이라 전부 인터페이스다. 런타임에 사라지므로 `@Body() dto: EmailSignupDto` 는 메타타입이 `Object` 가 되고, 전역 `ValidationPipe(whitelist, forbidNonWhitelisted)` 가 **아무것도 검사하지 않는다**. 모르는 필드도 통과했고 타입 검사도 없었다.

`WithdrawUserDto` 가 쓰던 방식(`class X implements SharedShape` + class-validator)으로 `/auth/*` 전체와 `PATCH /users/me` 를 고정했다. 의미 규칙(비밀번호 영문+숫자 조합 등)은 서비스에 그대로 뒀다 — 컨트롤러를 안 거치는 호출에서도 서야 하고, 사용자에게 보이는 문구의 정본이 거기다. DTO 는 타입·길이·형식과 모르는 필드 차단을 맡는다.

### 4.8 응답·입력 위생

- **`publicProfile()` 누락**: `getMe`/`updateMe` 는 감쌌는데 프로필 이미지 업로드·삭제가 빠져 `UserEntity` 원본이 나갔다. 실제 응답에 `$2b$12$...` 가 실려 있었다
- **`profileImageUrl` 은 `PATCH /users/me` 에서 제거**: 전용 업로드·삭제 엔드포인트가 있는데도 이 경로로 임의 외부 URL 을 넣을 수 있었다. 공유 타입에서도 빼 재도입을 막았다
- **알림 설정**: 알려진 카테고리 키 + boolean 만 통과시킨다. DTO 에서 한 번, 저장 직전에 한 번 좁힌다 — jsonb 는 한 번 들어간 쓰레기가 계속 실려 다니므로 과거 값도 걷어낸다

### 4.9 가입 경쟁과 로그인 타이밍

- **동시 가입**: 이메일 유니크 충돌은 "이미 있는 계정" 경로로 넘겨 §4.2 와 같은 응답을 내고, 핸들 충돌은 다른 후보로 재시도한다. 인덱스 이름은 TypeORM 이 해시로 만들어(`IDX_c25bc63d…`) 코드에 박을 수 없어서, Postgres `detail` 의 컬럼명으로 가른다(`common/db-errors`)
- **로그인 타이밍**: 없는 계정은 bcrypt 를 건너뛰어 즉시 401 이 돌아왔다. 같은 cost 의 더미 해시와 비교해 비용을 맞춘다

## 5. 운영 영향 (배포 전 확인)

이번 변경에는 **환경·운영 쪽 선행 조건**이 있다.

| 항목 | 조치 |
| --- | --- |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | 프로덕션에서 미설정이거나 `change-me-*` 면 **부팅 거부**. 실제 키로 교체 필수 |
| `KAKAO_CALLBACK_URL` | 시작 URL 이 여기서 파생된다. 카카오 콘솔 등록값과 정확히 일치해야 함 |
| `POST /auth/demo` | **제거됨.** 이 엔드포인트를 쓰던 스모크 체크·스크립트는 실제 계정 로그인으로 교체 |
| `seed:demo-live` | `SEED_USER_EMAIL` 필수. 해당 계정이 가입·인증돼 있어야 함 |
| Redis | 카카오 로그인 교환에 필요(이메일 로그인은 무관) |

## 6. 검증

`pnpm --filter @tripick/api test` 707 통과(검토 전 679 → 신규 28), `tsc --noEmit` API·web 클린, eslint 0 errors, Next 프로덕션 빌드 통과, e2e 스펙 68개 컴파일 확인.

주요 시나리오는 로컬 서버에 실제 요청을 보내 확인했다.

| 시나리오 | 결과 |
| --- | --- |
| 재설정 메일 링크 → 페이지 → 재설정 → 재로그인 | `http://localhost:3000/reset-password?token=…` HTTP 200 → 변경 → 로그인 성공 |
| 프로필 이미지 삭제 응답 (수정 전/후) | 전: `passwordHash: $2b$12$VXD.8nkQNx4AS…` / 후: 두 해시 모두 부재 |
| 프로덕션 부팅 + placeholder 시크릿 | `ERROR: JWT_SECRET 가 공개된 예시 값입니다` — 기동 거부 |
| `POST /auth/demo` | 404 |
| 카카오 콜백 state 없음 / 불일치 / 일치 | 앞 둘은 코드 교환 전 차단, 일치는 통과 후 `invalid_grant` |
| 브라우저 카카오 로그인 시작 (Playwright) | `localhost:3000/login` → **`localhost:4000/api/v1/auth/kakao`** → kauth. 쿠키 `domain=localhost path=/api/v1/auth httpOnly sameSite=Lax` |
| 계정 탈취(피해자 이메일로 재가입 → 공격자 비번 로그인) | 공격자 비번 401, 피해자 비번 로그인 성공, 주인에게 안내 메일 |
| 카카오 단독 가입자 비밀번호 재설정 | 메일 발송 → 새 비밀번호로 로그인 성공 |
| 같은 refresh 로 동시 5회 갱신 | 발급 성공 1, 나머지 `already rotated`, 승자 토큰 재갱신 성공(family 생존) |
| 같은 이메일로 동시 가입 5회 | 전부 200, **서로 다른 응답 본문 1종**, 생성된 계정 1개 |
| `/auth/*` 잘못된 본문 | 모르는 필드·형식·누락 전부 400 + 한국어 문구 |
| 알림 설정 임의 키·비-boolean | 400 |
| `PATCH /users/me { profileImageUrl }` | 400 `property profileImageUrl should not exist` |
| 로그인 응답 시간(각 6회 중앙값) | 존재 계정 175.5ms / 없는 계정 173.8ms |

로그인 타이밍 테스트는 더미 비교를 빼면 `0.15ms` 로 즉시 실패하는 것까지 확인해, 회귀를 실제로 잡는지 검증했다.

## 7. 알려진 한계 / 후속 작업

- **로그아웃이 access 토큰을 무효화하지 않는다.** refresh 만 폐기하고 access 는 최대 7일 유효하다. 진행 중 여행의 위치 보고가 리프레시 없이 돌아야 해서 TTL 을 길게 잡은 트레이드오프인데, 지금까지 문서에 없어 여기 적는다. 줄이려면 access 를 짧게 하고 위치 보고 경로에 갱신을 붙여야 한다
- **메일 발송 제한이 IP 기준뿐이다.** `forgot-password`·`resend-verification` 이 분당 3회지만 이메일 주소 기준 제한이 없어, IP 를 바꾸면 특정 주소로 메일을 몰 수 있다
- **핸들 백필이 부팅마다 전체 스캔**(`UsersService.onModuleInit`). 1회성 작업이라 마이그레이션으로 옮기는 게 맞다
- **`verifyEmail` 이 토큰을 먼저 소비**한다. 사용자가 없으면 토큰만 태워진다 — 순서를 뒤집는 게 낫다
- **닉네임 20자 규칙이 세 곳에 복붙**돼 있다(signup 서비스·update 서비스·DTO). 공용 상수로 뺄 것
- `isDemo` 는 이제 코드가 켜 주지 않는다. 데모 계정에는 운영자가 직접 켜야 한다

## 8. 변경 파일

```
apps/api/src/common/jwt-secrets.ts                    (신규 — 시크릿 해석·프로덕션 fail-fast)
apps/api/src/common/db-errors.ts                      (신규 — 유니크 위반 판정, 컬럼 단위)
apps/api/src/auth/dto/auth.dto.ts                     (신규 — /auth/* 요청 DTO)
apps/api/src/auth/kakao-exchange.service.ts           (신규 — 1회용 교환 코드)
apps/api/src/users/dto/update-user.dto.ts             (신규 — profileImageUrl 제외)
apps/api/src/users/dto/update-notification-preferences.dto.ts  (신규 — 키·값 제한)
apps/api/src/auth/auth.controller.ts                  (state 쿠키·교환 엔드포인트·DTO, /auth/demo 제거)
apps/api/src/auth/auth.service.ts                     (가입 경로 재구성, state·startUrl,
                                                       회전 원자화·유예·jti, 더미 해시 비교)
apps/api/src/auth/auth.module.ts                      (시크릿 통합, KakaoExchangeService 등록)
apps/api/src/auth/strategies/jwt.strategy.ts          (시크릿 통합)
apps/api/src/realtime/realtime.module.ts              (시크릿 통합 — 놓쳤던 네 번째 자리)
apps/api/src/users/users.controller.ts                (publicProfile 누락 보정, DTO)
apps/api/src/users/users.service.ts                   (데모 사용자 제거, 유니크 충돌 처리,
                                                       알림 설정 좁히기, profileImageUrl 제거)
apps/api/src/users/user.entity.ts                     (pendingPasswordHash 사용 규칙)
apps/api/src/email/email.service.ts                   (sendAccountExistsNotice)
apps/api/src/scripts/seed-demo-live.ts                (SEED_USER_EMAIL)
apps/api/.env.example                                 (시크릿 교체 안내)

apps/web/src/entities/session/api/auth-api.ts         (startDemoSession 제거, redirectToKakao 비동기,
                                                       exchangeKakaoCode)
apps/web/src/features/auth-start/ui/auth-start-actions.tsx     (CTA 재구성)
apps/web/src/views/auth-kakao-callback/ui/kakao-callback-view.tsx  (코드 교환)
apps/web/src/views/login/ui/login-view.tsx            (카카오 오류 표시)
apps/web/src/views/landing/ui/landing-view.tsx        ("로그인 없이 체험" 문구 정정)
apps/web/src/features/preference-setup/ui/preference-setup-form.tsx  (암묵적 세션 생성 제거)

packages/types/src/auth.ts                            (DemoLoginDto·authorizeUrl 제거, startUrl·
                                                       KakaoExchangeDto 추가)
packages/types/src/user.ts                            (UpdateUserDto 에서 profileImageUrl 제거)

apps/api/test/auth/kakao-exchange.service.spec.ts     (신규)
apps/api/test/common/jwt-secrets.spec.ts              (신규)
apps/api/test/common/db-errors.spec.ts                (신규)
apps/api/test/users/notification-preferences.spec.ts  (신규)
apps/api/test/auth/auth.service.spec.ts               (가입·회전·타이밍·state 케이스 갱신)
apps/api/test/e2e/travel-ai-planner.e2e-spec.ts       (실제 가입·로그인으로 부트스트랩)
.claude/skills/run-tripick/{SKILL.md,driver.mjs}      (드라이버 계정 로그인)
```
