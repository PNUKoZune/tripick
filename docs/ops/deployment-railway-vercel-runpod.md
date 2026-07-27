# 배포 가이드 — Railway + Vercel + RunPod

기준 브랜치: `develop` (`c432369`)
작성일: 2026-07-19

TriPick 을 매니지드 서비스 조합으로 배포하기 위한 구성·선행 작업·환경변수 전환표를 정리한다.
로컬 `docker-compose.yml` 의 Postgres/Redis/MinIO/Mailpit 은 **개발 전용**이며, 배포 시에는 각각 매니지드 서비스로 치환한다.

---

## 1. 배포 토폴로지

```
┌─ Vercel ──────────┐     ┌─ Railway ──────────────────────┐
│ apps/web (Next 16)│────▶│ apps/api (NestJS)              │
└───────────────────┘ WS  │  + Postgres (pgvector) 서비스  │
                          │  + Redis 서비스                │
┌─ RN 앱 (스토어) ──┐────▶│                                │
└───────────────────┘     └──────────┬─────────────────────┘
                                     │ OpenAI-compatible
                          ┌──────────▼─────────────────────┐
                          │ RunPod (GPU)                   │
                          │  :8080 vLLM (Gemma, chat)      │
                          │  :8081 TEI (BGE-m3-ko, 임베딩) │
                          └────────────────────────────────┘

┌─ Cloudflare R2 (MinIO 대체) ─┐  ┌─ Resend SMTP (Mailpit 대체) ─┐
```

**Nginx 는 배포 구성에서 제외한다.** CLAUDE.md 는 라이브 전용 Nginx(SSL 터미네이션·WebSocket 업그레이드 헤더)를 명시하고 있으나,
Railway 가 TLS 종료와 WebSocket 업그레이드를 모두 처리하므로 불필요하다.

---

## 2. 배포 대상별 역할

| 대상 | 플랫폼 | 비고 |
| --- | --- | --- |
| `apps/web` | Vercel | Next.js 16 App Router, WebView 내 웹앱 |
| `apps/api` | Railway | NestJS + BullMQ Worker 동일 프로세스 |
| PostgreSQL + pgvector | Railway (커스텀 Docker) | `pgvector/pgvector:pg16` 고정 |
| Redis | Railway 애드온 | 캐시·세션·BullMQ·Throttler 공용 |
| LLM 추론 | RunPod | chat + 임베딩 **2개 엔드포인트** |
| Object Storage | Cloudflare R2 | S3 호환, 엔드포인트만 전환 |
| SMTP | Resend | `EMAIL_TRANSPORT=smtp` 유지 |
| `apps/mobile` | 스토어 배포 | 본 문서 범위 외 |

---

## 3. RunPod — 엔드포인트 2개 구성

`apps/api/.env.example` 기준으로 chat 추론과 임베딩 서버가 분리되어 있다. 둘 다 필요하다.

| 용도 | 환경변수 | 서빙 스택 | 기본 포트 |
| --- | --- | --- | --- |
| 일정 생성·재계획 추론 | `LLM_BASE_URL` | vLLM + Gemma | 8080 |
| RAG/CRAG 임베딩 | `LLM_EMBEDDING_BASE_URL` | TEI 또는 Infinity + `dragonkue/BGE-m3-ko` | 8081 |

### 차원 일치 제약

`LLM_EMBEDDING_DIMENSIONS=1024` 는 `vector(1024)` 컬럼과 **반드시 일치**해야 한다
(정의: `apps/api/src/database/migrations/1700000000000-InitVectorSchema.ts`, 로컬 사본 `infra/postgres/init.sql`).
`preference_embeddings.embedding` 과 `place_embeddings.embedding` 이 동일 차원이어야 하며,
임베딩 모델 교체 시 DB 스키마 변경과 전체 재임베딩(`pnpm --filter @tripick/api reembed:preferences`)이 함께 필요하다.

### Pod 유형 선택

- **Pod (상시)**: 재계획 잡이 대기 없이 처리되어야 하므로 chat 추론은 상시 Pod 권장
- **Serverless**: 콜드스타트가 수십 초 발생. 선택 시 `LLM_PLANNER_TIMEOUT_MS` 상향이 필수 전제
- 임베딩은 부하가 낮아 동일 Pod 내 별도 컨테이너로 병설 가능

### 타임아웃 주의

`LLM_PLANNER_TIMEOUT_MS` 기본값은 `12000`(12초)이다. 로컬 LLM 서빙 환경에서 이미 부족한 값이며,
RunPod 콜드스타트가 겹치면 무조건 타임아웃된다. 프로덕션은 **90000 이상**으로 설정한다.

---

## 4. Railway 구성

### 4-1. Postgres 서비스

기본 Postgres 템플릿이 아닌 **커스텀 Docker 서비스로 `pgvector/pgvector:pg16`** 를 배포한다.
일반 `postgres:16` 이미지는 `CREATE EXTENSION vector` 가 불가하여 사용을 금지한다.

스키마는 손댈 필요가 없다 — API 컨테이너가 부팅하면서 TypeORM 마이그레이션으로
확장·테이블·인덱스를 모두 만든다 (5-2 참조). 빈 DB 만 준비하면 된다.

### 4-2. Redis 서비스

Railway Redis 애드온을 사용한다. 단 접속 정보가 비밀번호를 포함한 `REDIS_URL` 형태로 제공되므로
**선행 코드 수정(5-1)이 완료되어야 접속 가능**하다.

### 4-3. API 서비스

- 레포 연결 후 Dockerfile 빌드 방식으로 배포
- **Dockerfile: `apps/api/Dockerfile`** (작성 완료). 빌드 컨텍스트는 **모노레포 루트**여야 한다
  (pnpm-lock·`packages/*` 접근 필요). Railway 설정에서 Root Directory 는 레포 루트,
  Dockerfile Path 는 `apps/api/Dockerfile` 로 지정한다
- 로컬 빌드 예: `docker build -f apps/api/Dockerfile -t tripick-api .`
- 멀티스테이지: 전체 워크스페이스 의존성 설치 → `turbo run build --filter=@tripick/api`
  (types·utils 먼저 빌드) → `pnpm deploy --prod` 로 dist + 프로덕션 node_modules +
  워크스페이스 빌드 산출물을 주입한 자립 번들 생성 → 경량 runner 스테이지가 그것만 담아 실행
- 런타임: `node:20-slim` 비루트(`node`) 실행, `CMD node dist/main.js`, `PORT` 환경변수 우선
- **replica 는 1개로 고정한다** (사유는 5-3 참조)

---

## 5. 선행 코드 작업 (배포 전 필수)

현재 `develop` 상태로는 그대로 배포되지 않는다. 아래 항목을 처리한다.
`chore/production-deploy-prep` 브랜치에서 **5-1·5-2·5-4·5-5 를 구현 완료**했다.
5-3 은 MVP 운영 제약으로 남긴다.

### 5-1. Redis 접속에 비밀번호·TLS 지원 없음 — 필수 ✅ 구현 완료

`REDIS_HOST`/`REDIS_PORT` 만 읽던 아래 8곳이 인증이 필요한 매니지드 Redis 에 접속할 수 없었다.

- `apps/api/src/app.module.ts` — Throttler 스토리지, BullMQ 커넥션 (2곳)
- `apps/api/src/planner/helpers/route.helper.ts`
- `apps/api/src/planner/helpers/weather.helper.ts`
- `apps/api/src/weather-alert/weather-alert.service.ts`
- `apps/api/src/crowd-alert/crowd-alert.service.ts`
- `apps/api/src/arrival-alert/live-location.service.ts`
- `apps/api/src/notification-scheduler/trip-reminder.service.ts`

**조치**: 공통 팩토리 `apps/api/src/common/redis.config.ts` (`redisConnection`) 도입.
`REDIS_URL`(`rediss://` 이면 TLS) 우선 → 미설정 시 host/port 폴백. 인스턴스별 옵션
(`lazyConnect`·`maxRetriesPerRequest` 등)은 `extra` 인자로 병합한다.
파싱 검증은 `apps/api/test/common/redis.config.spec.ts`.

### 5-2. 프로덕션에서 스키마가 생성되지 않음 — 필수 ✅ 구현 완료

**문제**. 프로덕션 DB 에 테이블을 만들어주는 주체가 아무도 없었다.

- `app.module.ts` 의 `synchronize` 는 `NODE_ENV === 'development'` 일 때만 활성 → 엔티티 테이블 13개 미생성
- `infra/postgres/init.sql` 은 docker-compose entrypoint 로만 실행 → pgvector 테이블 3개도 미생성

**조치**: TypeORM 마이그레이션으로 전환했다. 첫 배포 전이라 프로덕션 데이터가 없어
전환 비용·위험이 가장 낮은 시점이었다.

| 추가 | 내용 |
| --- | --- |
| `apps/api/src/database/data-source.ts` | CLI 전용 DataSource. `entities`·`migrations` 를 glob 으로 수집 |
| `.../migrations/1700000000000-InitVectorSchema.ts` | 확장 + pgvector 테이블. **손으로 작성** |
| `.../migrations/1785135565704-InitEntities.ts` | 엔티티 13개 DDL. `migration:generate` 자동 생성 |
| package.json | `typeorm`·`migration:{generate,run,revert,show}` 스크립트 |

**동작 방식** — 개발과 프로덕션을 배타적으로 나눴다. 둘 다 켜면 `synchronize` 가
마이그레이션 결과를 덮어쓸 수 있다.

```ts
synchronize:    isDevelopment,   // 개발: 지금까지처럼 자동 반영
migrationsRun: !isDevelopment,   // 그 외: 부팅 시 마이그레이션 실행
```

즉 **Railway 에서 별도 배포 단계가 필요 없다** — 컨테이너가 뜨면서 스스로 스키마를 맞춘다.
replica 1개 운영(5-3)이라 동시 실행 경합이 없기에 성립하는 방식이고,
인스턴스를 늘리면 배포 파이프라인의 독립 단계로 빼야 한다.

**순서 보장.** pgvector 마이그레이션이 `uuid-ossp` 확장을 만들고 엔티티 DDL 이 그걸 쓰므로,
타임스탬프를 `1700000000000` 으로 의도적으로 낮게 고정해 항상 먼저 실행되게 했다.

**`init.sql` 은 남긴다.** 로컬 docker-compose 최초 기동용으로 계속 쓰이며,
마이그레이션 파일과 내용이 같아야 한다. 한쪽만 고치지 않도록 양쪽에 주석을 달아뒀다.

#### 알아둘 것

- **기존 로컬 DB 에 `migration:run` 을 돌리면 실패한다.** `synchronize` 로 이미 만들어진
  테이블에 `CREATE TABLE` 이 부딪힌다. 개발 DB 는 `docker compose down -v` 후 재생성이 제일 깔끔하다.
  평소 개발은 `synchronize` 경로라 마이그레이션을 돌릴 일 자체가 없다
- **`migration:generate` 는 매번 `notificationPreferences` 기본값 한 줄을 노이즈로 낸다.**
  Postgres 가 jsonb 기본값의 키 순서·공백을 정규화해 저장하는데 TypeORM 이 원본 문자열과
  단순 비교하기 때문. 실제 차이가 아니므로 생성된 마이그레이션에서 지우면 된다

#### 검증

빈 DB 를 새로 만들어 `NODE_ENV=production` 으로 `dist` 를 기동하는 실제 경로를 그대로 밟았다.

- 부팅 시 마이그레이션 2건 자동 적용 (`migrations` 테이블에 기록됨)
- 테이블 17개(엔티티 13 + 벡터 3 + `migrations`), 확장 `vector`·`uuid-ossp`, HNSW 인덱스 2개 생성 확인
- `POST /auth/demo` 200 — uuid 기본값·jsonb 기본값·FK 까지 쓰기 경로 동작 확인
- 적용 후 `migration:generate` 재실행 시 위 jsonb 노이즈 외 스키마 차이 없음

### 5-3. Socket.IO Redis 어댑터 미설치 — 스케일 제약

CLAUDE.md 아키텍처에 "Redis Adapter / Pub-Sub Sync" 가 명시되어 있으나,
실제로는 `@socket.io/redis-adapter` 의존성이 없고 `main.ts` 에 `IoAdapter` 설정도 없다.

따라서 **API 인스턴스를 2개 이상으로 확장하면 WebSocket 브로드캐스트가 인스턴스 간에 전파되지 않아
재계획 결과 push 가 유실된다.** MVP 는 replica 1개로 운영하고, 수평 확장이 필요해지는 시점에 어댑터를 도입한다.

### 5-4. WebSocket 게이트웨이 CORS 와일드카드 — 권장 ✅ 구현 완료

`realtime.gateway.ts` 가 `origin: '*'` 였다.

**조치**: 공통 헬퍼 `apps/api/src/common/cors.ts` (`corsOrigins`) 도입. `CORS_ORIGIN`
환경변수(쉼표 구분) → 미설정 시 로컬 기본값. HTTP(`main.ts`)·WebSocket(게이트웨이)이 공유한다.
프로덕션은 `CORS_ORIGIN` 에 Vercel 도메인을 지정한다.

### 5-5. 헬스체크 엔드포인트 부재 — 권장 ✅ 구현 완료

**조치**: `apps/api/src/health/health.controller.ts` 추가 → `GET /api/v1/health` 가
`{ status: 'ok' }` 반환. 레이트리밋 면제(`@SkipThrottle`), 의존성 상태는 확인하지 않는
라이브니스(의존성 일시 장애로 인한 재시작 플래핑 방지). Railway 헬스체크 경로로 지정한다.

---

## 6. 환경변수 전환표 (apps/api)

| 항목 | 로컬 | 프로덕션 |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` (Swagger 자동 비활성) |
| `DATABASE_URL` | `...@localhost:5432` | Railway 내부 URL (`*.railway.internal`) |
| Redis | `REDIS_HOST` / `REDIS_PORT` | `REDIS_URL` (비밀번호 포함) — **5-1 선행 필요** |
| `STORAGE_ENDPOINT` | `http://localhost:9000` | R2 S3 API 엔드포인트 |
| `STORAGE_PUBLIC_URL` | `http://localhost:9000/tripick` | R2 공개 도메인 |
| `SMTP_HOST` / `SMTP_PORT` | `localhost` / `1025` | Resend SMTP |
| `LLM_BASE_URL` | `http://localhost:8080/v1` | RunPod chat 엔드포인트 |
| `LLM_EMBEDDING_BASE_URL` | `http://localhost:8081/v1` | RunPod 임베딩 엔드포인트 |
| `LLM_PLANNER_TIMEOUT_MS` | `12000` | **`90000` 이상** |
| `PLACE_RETRIEVAL_AUTO_SEED` | `true` | **`false`** (seed 가 실제 카카오 결과를 가림) |
| `KAKAO_CALLBACK_URL` | `http://localhost:4000/...` | Railway API 도메인 |
| `WEB_APP_URL` | `http://localhost:3000` | Vercel 도메인 |
| `CORS_ORIGIN` | (기본값) | Vercel 도메인 (쉼표 구분) |
| `ODSAY_SERVICE_URL` | `http://localhost:4000` | **ODsay 콘솔 등록 도메인과 정확히 일치** |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | `change-me-*` | 별도 생성한 시크릿 |
| `SENTRY_DSN` | (비움) | 프로덕션 DSN |

### ODsay 주의

`ODSAY_SERVICE_URL` 이 등록 도메인과 다르면 HTTP 200 + `[ApiKeyAuthFailed]` 로 **조용히 실패**한다.
axios 가 예외를 던지지 않아 `RouteHelper` 가 직선거리 추정치로 폴백하며, 에러 로그도 남지 않는다.
대중교통 소요시간이 부정확하면 이 설정부터 확인한다.

---

## 7. Vercel 구성 (apps/web)

모노레포 구조에 맞춘 프로젝트 설정이 필요하다.

| 설정 | 값 |
| --- | --- |
| Root Directory | `apps/web` |
| Install Command | `pnpm install` (루트 기준) |
| Build Command | `cd ../.. && pnpm turbo run build --filter=@tripick/web` |

### 환경변수

| 변수 | 값 |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | `https://<railway-domain>/api/v1` |
| `NEXT_PUBLIC_WS_URL` | `https://<railway-domain>` |
| `NEXT_PUBLIC_KAKAO_MAP_KEY` | 카카오 JS 키 |

`NEXT_PUBLIC_WS_URL` 은 **반드시 `https`** 로 지정한다. HTTPS 페이지에서 `ws://` 로 접속하면
mixed content 로 차단된다.

### 외부 콘솔 도메인 등록

- 카카오 개발자 콘솔: 플랫폼 웹 도메인에 Vercel 도메인 등록
- 카카오 OAuth: Redirect URI 에 Railway API 콜백 URL 등록
- ODsay: 서비스 URL 등록 (6절 참조)

Geolocation 은 HTTPS 환경에서만 동작하나, Vercel 은 기본 HTTPS 이므로 별도 대응이 불필요하다.

---

## 8. 배포 순서

1. **선행 코드 작업** — 5-1(Redis URL 통합), 5-2(마이그레이션), 5-4(CORS 제한), 5-5(헬스체크) 모두 완료
2. **Dockerfile** — `apps/api/Dockerfile` 작성 완료 (컨텍스트=레포 루트)
3. **Railway**
   1. Postgres 서비스 배포 (`pgvector/pgvector:pg16`)
   2. Redis 애드온 추가
   3. API 서비스 배포 (replica 1) — 부팅 시 마이그레이션이 스키마를 자동 생성한다
4. **RunPod** — vLLM + TEI 기동 후 엔드포인트 확보 → Railway 환경변수 주입
5. **Vercel** — web 배포 → 카카오/ODsay 콘솔에 도메인 등록
6. **R2 버킷 생성 + Resend SMTP 전환**

---

## 9. 배포 후 확인 항목

- `GET /api/v1/health` 200 응답
- 카카오 OAuth 로그인 → JWT 발급 왕복
- WebSocket `/realtime` 네임스페이스 연결 및 JWT 인증
- 일정 생성 1건 — LLM 엔드포인트 실제 호출 여부 확인 (폴백 여부 로그 확인)
- 경로 조회 — 직선거리 폴백이 아닌 실제 API 응답인지 확인
- 이미지 업로드 → R2 저장 및 공개 URL 접근
- BullMQ 재계획 잡 처리 → WebSocket/FCM push 도달
- Sentry 이벤트 수신

---

## 10. 알려진 제약

- **API replica 1개 고정** — Socket.IO Redis 어댑터 미도입 (5-3)
- **BullMQ Worker 가 API 와 동일 프로세스** — 재계획 잡이 API 응답성과 자원을 공유한다.
  부하 증가 시 Worker 를 별도 Railway 서비스로 분리하는 것을 검토한다.
- **스키마 변경이 수동** — TypeORM 마이그레이션 미도입 (5-2)
- **RunPod 엔드포인트 URL 변동** — Pod 재시작 시 주소가 바뀌면 Railway 환경변수 갱신이 필요하다
