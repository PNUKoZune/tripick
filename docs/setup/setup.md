# TriPick 로컬 셋업 · 실행 검증

문서 목적: 레포를 처음 받은 사람이 로컬에서 web·API·앱을 띄우고, 어디까지 실제로 동작하는지 확인하는 절차를 고정한다.

기준 브랜치: `develop`
검증 일시: 2026-08-31

> 프로젝트 소개·아키텍처는 최상위 [README.md](../../README.md), 전반 컨텍스트는 [CLAUDE.md](../../CLAUDE.md).

---

## 1. 요구 사항

| 항목                          | 버전 | 비고                                  |
| ----------------------------- | ---- | ------------------------------------- |
| Node.js                       | 20   | [.nvmrc](../../.nvmrc)                |
| pnpm                          | 9    | `corepack enable` 로 설치             |
| Docker                        | —    | Postgres · Redis · MinIO · Mailpit    |
| (선택) GPU + llama.cpp        | —    | 로컬 LLM. 없으면 폴백 플래닝으로 동작 |
| (선택) Android Studio / Xcode | —    | 모바일 앱을 띄울 때만                 |

## 2. 셋업

```bash
corepack enable
pnpm install

cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env

pnpm start          # db:up(Docker) + turbo run dev → web:3000, api:4000
```

- `pnpm start` = `pnpm db:up` + `pnpm dev`. 인프라만 올리려면 `pnpm db:up`, 내리려면 `pnpm db:down`.
- 루트 `pnpm dev` 는 **web·API 만** 띄운다. `apps/mobile` 에는 `dev` 스크립트가 없어 turbo 대상에서 빠진다(§6).
- 개발 모드는 TypeORM `synchronize: true` 라 스키마가 자동 반영된다. 마이그레이션 실행은 배포 환경(`NODE_ENV != development`)에서만 필요하다 — [app.module.ts](../../apps/api/src/app.module.ts) 참고.

### 첫 계정 만들기

**익명·공유 데모 세션은 없다.** 예전의 `POST /auth/demo` 는 제거됐으므로 실제 계정으로 가입한다.

1. `http://localhost:3000/signup` 에서 가입
2. **Mailpit(`http://localhost:8025`)** 에서 인증 메일 확인 → 링크 클릭
3. 로그인

로컬 기본값이 `EMAIL_TRANSPORT=smtp` + `SMTP_HOST=localhost:1025` 라 메일은 전부 Mailpit 으로 들어간다.
콘솔에 본문만 찍고 싶으면 `EMAIL_TRANSPORT=console`.

데모 여행 데이터가 필요하면 가입한 계정 이메일로 시드한다.

```bash
cd apps/api && SEED_USER_EMAIL=demo@tripick.place pnpm seed:demo-live
```

## 3. 포트 · 엔드포인트

| 서비스         | 주소                               | 비고                                 |
| -------------- | ---------------------------------- | ------------------------------------ |
| Web (Next.js)  | http://localhost:3000              |                                      |
| API (NestJS)   | http://localhost:4000/api/v1       | 헬스체크 `/api/v1/health`            |
| Swagger        | http://localhost:4000/api/docs     | 비프로덕션에서만 서빙                |
| PostgreSQL     | localhost:5432                     | `tripick` / `tripick` / DB `tripick` |
| Redis          | localhost:6379                     |                                      |
| MinIO          | http://localhost:9000 (콘솔 :9001) | `minioadmin` / `minioadmin`          |
| Mailpit        | http://localhost:8025 (SMTP :1025) |                                      |
| Metro (모바일) | localhost:8081                     |                                      |

Docker 포트는 전부 `127.0.0.1` 에만 바인딩한다 — 자격증명이 기본값이라 `0.0.0.0` 으로 열면 같은 네트워크에서 DB·스토리지·잡 큐가 그대로 노출된다.

웹은 `NEXT_PUBLIC_API_URL=/api/v1` 상대경로로 부르고, Next rewrite 가 `TRIPICK_API_ORIGIN`(기본 `http://127.0.0.1:4000`) 으로 프록시한다. 오브젝트 스토리지도 같은 방식(`/storage`, `/storage-private`) — 절대 URL 을 쓰면 WebView 에서 기기 자신을 가리켜 이미지가 안 뜬다.

## 4. 환경변수

전체 목록과 각 값의 근거는 [apps/api/.env.example](../../apps/api/.env.example) · [apps/web/.env.example](../../apps/web/.env.example) 주석에 있다. 여기서는 **없으면 무엇이 죽는지**만 정리한다.

### 없어도 뜨는 것 (기능만 폴백)

| 키                                           | 없을 때                                                  |
| -------------------------------------------- | -------------------------------------------------------- |
| `KAKAO_REST_API_KEY` · `KAKAO_LOCAL_API_KEY` | 장소 검색이 카탈로그·시드만, 자동차 경로는 직선거리 추정 |
| `NEXT_PUBLIC_KAKAO_MAP_KEY`                  | 웹 지도 미표시                                           |
| `ODSAY_API_KEY` · `ODSAY_SERVICE_URL`        | 대중교통 ETA 가 직선거리 추정                            |
| `KMA_API_KEY`                                | 날씨 카드·날씨 알림 비활성                               |
| `KTO_API_KEY`                                | 카탈로그 적재·관광지 집중률 불가                         |
| `NAVER_SEARCH_CLIENT_ID` · `_SECRET`         | 인지도 항이 중립값 → 랭킹 불변                           |
| `FIREBASE_*`                                 | 푸시 없이 인박스 알림만                                  |
| `SENTRY_DSN`                                 | SDK no-op                                                |
| LLM 3종 (§5)                                 | 규칙 기반 폴백 플래닝                                    |

### 로컬에서 실제로 채워야 하는 것

- `DATABASE_URL` · `REDIS_HOST` / `REDIS_PORT` — `.env.example` 기본값이 docker-compose 와 맞아 그대로 두면 된다.
- `STORAGE_*` — MinIO 기본값 그대로. 단 `STORAGE_ENDPOINT` 의 host 는 web 의 `TRIPICK_STORAGE_ORIGIN`(기본 `http://127.0.0.1:9000/...`)과 **정확히 같아야 한다**. `localhost` 로 서명하고 `127.0.0.1` 로 프록시하면 SigV4 서명 host 불일치로 403 이 나고, 화면에는 이미지만 조용히 안 뜬다.
- `JWT_SECRET` · `JWT_REFRESH_SECRET` — 로컬은 예시 값으로 돌아가지만 **`NODE_ENV=production` 이면 `change-me-*` 값으로 부팅이 거부**된다.

## 5. 로컬 LLM

일정 생성·취향 사진 분석·임베딩은 OpenAI 호환 엔드포인트를 호출한다. 용도별로 주소가 셋이고, 미설정 시 서로 폴백한다.

| 용도               | 환경변수                                            | 미설정 시                          |
| ------------------ | --------------------------------------------------- | ---------------------------------- |
| 일정 생성 (chat)   | `LLM_BASE_URL` / `LLM_MODEL`                        | 로컬 기본값 → 실패하면 폴백 플래닝 |
| 임베딩             | `LLM_EMBEDDING_BASE_URL` / `_MODEL` / `_DIMENSIONS` | `LLM_BASE_URL` 로 폴백             |
| 취향 사진 (vision) | `LLM_VISION_BASE_URL` / `_MODEL`                    | chat 설정으로 폴백                 |

```bash
# chat + vision (mmproj 필수 — 없으면 사진 분석만 실패한다)
llama-server -m gemma-4-26b-q4.gguf --mmproj mmproj.gguf --port 8080

# 임베딩 (BGE-m3-ko). 차원은 pgvector 컬럼과 반드시 일치 — 기본 1024
llama-server -m bge-m3-ko.gguf --embedding --port 8081
```

- **`LLM_PLANNER_TIMEOUT_MS` 를 줄이지 말 것.** 기본 90s 다. 로컬 모델은 후보 16개짜리 프롬프트에 수십 초가 걸려서, 짧게 잡으면 조용히 폴백 플래닝으로 빠지고 일정 메모가 "AI planner fallback" 으로 남는다.
- 서버를 아예 안 띄울 거면 `LLM_PLANNER_ENABLED=false`. 규칙 기반으로 일정이 생성돼 화면 흐름은 끝까지 볼 수 있다.
- 임베딩 서버가 없으면 결정적 해시 폴백으로 차원만 맞춘다 — **화면은 도는데 검색 품질은 의미가 없다.** 적재 시점과 조회 시점의 모델이 같아야 pgvector 코사인이 성립한다.

### 후보 카탈로그

`place_embeddings` 가 비어 있으면 검색이 시드 후보로 떨어진다. 실제 카탈로그를 적재하려면(임베딩 서버 필요):

```bash
pnpm --filter @tripick/api ingest:places -- --regions=서울,부산 --sources=tour,kakao --max=100
pnpm --filter @tripick/api ingest:places -- --sources=popular --max=60   # 대표 명소·맛집만 얕게
```

`PLACE_RETRIEVAL_AUTO_SEED=true`(기본) 는 **해당 지역 후보가 0건일 때만** 시드를 넣는다. 적재된 지역은 건드리지 않는다.

## 6. 모바일 앱

`apps/mobile` 은 웹앱을 로드하는 WebView 셸이다(위치 보고 · FCM · 딥링크 · 카카오 인앱 브라우저).

```bash
pnpm dev:android    # 또는 pnpm dev:ios
```

- 웹 주소는 env 가 아니라 [App.tsx](../../apps/mobile/src/App.tsx#L73) 에 박혀 있다 — dev 는 Android `http://10.0.2.2:3000` / iOS `http://localhost:3000`, release 는 `https://tripick.place`.
- Firebase 클라이언트 자격 파일(`google-services.json`, `GoogleService-Info.plist`)은 gitignore 대상이라 따로 받아 넣어야 푸시가 붙는다.
- 패키지 ID 는 `com.tripick.place` (Android `applicationId`·`namespace`, iOS bundle id 동일).
- WSL 에서는 Windows 쪽 `adb.exe`·`emulator.exe` 를 경유해야 하고, 에뮬레이터 GPU 는 `swiftshader` 로 두면 부팅에 실패한다.

## 7. 자주 쓰는 스크립트

| 명령                                                                | 용도                                                                                   |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `pnpm --filter @tripick/api ingest:places`                          | 장소 카탈로그 적재 (`--regions` · `--sources=tour,kakao,popular,keyword` · `--append`) |
| `pnpm --filter @tripick/api eval:retrieval`                         | 골든셋 검색 품질 평가. `-- --sweep=KEY=v1,v2` 로 노브 스윕                             |
| `pnpm --filter @tripick/api seed:demo-live`                         | 데모 여행 시드 (`SEED_USER_EMAIL` 필수)                                                |
| `pnpm --filter @tripick/api reembed:places` / `reembed:preferences` | 임베딩 모델 교체 후 재계산                                                             |
| `pnpm --filter @tripick/api migration:generate` / `migration:run`   | 배포 환경용 스키마 마이그레이션                                                        |

## 8. 현재 검증 상태

2026-08-31 `develop` 기준 실측.

| 명령                                          | 결과                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| `pnpm turbo run typecheck`                    | 5/5 성공 (api · web · mobile · types · utils)                          |
| `pnpm turbo run build`                        | 4/4 성공                                                               |
| `pnpm turbo run test`                         | 73 스위트 · 928 테스트 전부 통과                                       |
| `pnpm --filter @tripick/api test:e2e`         | DB 필요 — `TEST_ADMIN_DATABASE_URL` · `TEST_DATABASE_URL` 지정 시 동작 |
| `pnpm --filter @tripick/api test:integration` | 로컬 LLM 필요 (CI 에서 안 돈다)                                        |

2026-05-06 시점의 blocker 였던 항목들은 모두 해소됐다 — 모바일 Metro 설정 부재, web·mobile 타입 오류, 카카오 OAuth 미연동, 이미지 기반 취향 분석 미검증.

## 9. 자주 막히는 지점

| 증상                              | 원인 · 조치                                                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `NoSuchBucket`                    | MinIO 버킷 미생성 → `docker compose up minio-init` 1회 실행                                                           |
| 프로필·취향 사진만 안 뜸 (403)    | `STORAGE_ENDPOINT` host 와 web 프록시 host 불일치 → 양쪽 다 `127.0.0.1` 로 통일                                       |
| 가입은 되는데 메일이 안 옴        | `http://localhost:8025` (Mailpit) 확인. 실제 발송이 필요하면 `EMAIL_TRANSPORT=resend`                                 |
| 일정 메모가 "AI planner fallback" | LLM 타임아웃 또는 서버 미기동 → `LLM_PLANNER_TIMEOUT_MS` 확인 (기본 90s)                                              |
| 이동 시간이 이상함                | 경로 API 실패 시 직선거리 추정으로 조용히 폴백한다. 카카오·ODsay 는 실패도 HTTP 200 으로 주므로 응답 본문을 봐야 한다 |
| ODsay 가 `[ApiKeyAuthFailed]`     | `ODSAY_SERVICE_URL` 이 키 발급 시 등록한 도메인과 정확히 같아야 한다 (로컬 `http://localhost:4000`)                   |
| 웹 지도가 빈 화면                 | `NEXT_PUBLIC_KAKAO_MAP_KEY` 미설정, 또는 카카오 콘솔에 `localhost:3000` 도메인 미등록                                 |
| Geolocation 이 안 잡힘            | HTTPS 또는 `localhost` 에서만 동작. Android WebView 권한은 네이티브가 처리하므로 JS 에서 할 게 없다                   |
| RN 빌드가 옛 패키지명을 참조      | `cd apps/mobile/android && rm -rf build app/build .gradle` (autolinking 캐시)                                         |

## 10. 로컬에서 못 하는 것

- **분리 배포 검증** — 로컬은 BullMQ Worker 가 API 와 같은 프로세스에서 돈다. 워커를 떼어낸 구성은 배포 환경에서만 확인 가능하다.
- **APNs 푸시** — iOS 실기기 + 인증서가 필요하다.
- **집중률 알림 실데이터** — 관광공사 방문자 추이 예측은 하루 1회 스캔이라 즉시 재현이 어렵다.
- **프로덕션 부팅 가드** — `JWT_*` 기본값 거부, 이메일 발송 설정 필수 검증은 `NODE_ENV=production` 에서만 걸린다.

배포 구성은 [docs/ops/deployment-railway-vercel-runpod.md](../ops/deployment-railway-vercel-runpod.md) 참고.
