# TriPick (트리픽) — 프로젝트 컨텍스트

> **Trip + Pick**: 취향으로 골라주는 AI 여행 플래너 에이전트

> 기능별 상세 문서(결정·근거·검증)는 [docs/README.md](docs/README.md) 인덱스에서 도메인별로 찾는다.

---

## 1. 서비스 개요

사용자의 이미지 취향 분석을 반영하여 국내 여행 일정을 자동 생성하고, 경로 이탈(미도착)·날씨·혼잡 등 실시간 맥락 변화 시 일정 조정을 추천(알림)하는 AI 에이전트 서비스. 실제 재계획은 사용자가 알림을 확인한 뒤 수동으로 요청한다. React Native 앱(Next.js WebView) + NestJS 백엔드 + 프라이빗 LLM 추론 인프라로 구성.

---

## 2. 시스템 아키텍처 레이어 구조

### CLIENT LAYER

- **React Native Mobile App**
  - Location Tracking, Trip Progress
  - Push Notification, WebView Container
  - REST API → NestJS API Gateway
- **Next.js WebView / Web App** (Deployed on Vercel)
  - Map UI, Itinerary Review, Preference Input
  - Client Cache
  - REST API + WebSocket → NestJS

### API LAYER (NestJS API Gateway)

- **모듈**: Auth, Users, Trips, Itinerary, Preferences, Replanning, Realtime Events, Notification
- **미들웨어**: JWT + Passport, Rate Limit
- **WebSocket Gateway** (Socket.IO 기반)
  - Trip Session Ch. / Deviation Ch. / Replan Result Ch.
  - Redis Adapter / Pub/Sub Sync
- 주요 흐름:
  - `Trips` → generate itinerary → AI AGENT LAYER
  - `Replanning` → replan request → Planner Agent Orchestrator
  - deviation context → WebSocket Gateway
  - enqueue replan job → BullMQ
  - push alert → Notification 모듈

### AI AGENT LAYER (Core)

- **Planner Agent Orchestrator** (`PlannerService`)
  - Tool Orchestration: `PlannerService`가 retrieval·weather·route helper 를 코드로 직접 조율(결정적 순서). LLM 이 툴 선택에 개입하는 agentic 라우팅 아님 — 별도 `ToolRouter` 컴포넌트 없음
  - Local LLM Call: LLM 추론 실행 (`PlannerAgentService`)
  - Prompt Building: 단일 파라미터화 프롬프트에 `trigger`(deviation·weather·manual)·notes 를 데이터로 주입해 시나리오 분기. 시나리오별 개별 템플릿 파일은 없음
  - JSON Plan Generator: 일정 JSON 생성·검증(candidateId 검증, 중복 슬롯 제거)
  - Constraint Validation Loop: AI draft 검증 실패 시 **근접 후보 우선**(직전 배치 장소에서 하버사인 최근접) 정렬 기반 결정적 재생성 최대 3회 (LLM 재호출 아님). 회차마다 시드를 옮겨 다른 군집을 만들고, 오늘 일차를 다시 짤 때는 사용자 현재 위치에서 가까운 후보를 시드로 잡는다
  - _"Coordinates tools, LLM and constraints to produce a valid itinerary."_

- **Local LLM Serving ★** (프라이빗 추론 인프라)
  - MVP: Gemma 4 + llama.cpp / vLLM
  - 보조 모델: NVIDIA Triton Inference Server (vision·embedding·reranking)
  - OpenAI-compatible API 인터페이스
  - Itinerary Reasoning / Alternative Plan Explanation
  - session/cache: Redis 연동

- **Vision Preference Analyzer**
  - Gallery Photo Analysis (사용자 갤러리에서 직접 선택·업로드)
  - Taste Tag Extraction
  - Food / Mood / Nature-City Preference 분류
  - photo metadata → pgvector 임베딩 저장

- **Constraint Engine**
  - Sleep / Wake Time (취침·기상 시간 제약)
  - Opening Hours (영업시간 검증)
  - Travel Time (이동 시간 계산)
  - Route Feasibility (경로 실현 가능성)

### DATA LAYER

- **PostgreSQL**: users, trips, itinerary items, constraints
- **pgvector**: taste embeddings, place embeddings (RAG + CRAG 검색)
- **Redis**: session cache, pub/sub, API cache
- **BullMQ**: replanning jobs, async AI tasks
- **Object Storage**: 사용자 업로드 사진(갤러리), extracted metadata

### EXTERNAL TOOL LAYER

- **카카오맵 / Local API**: place search, map rendering
- **카카오 모빌리티 / ODsay**: route ETA (car), public transit
- **네이버 블로그·카페 검색** (NCP API Hub): popularity signal (대중 인지도로 후보 재랭킹)
- **Korea Meteorological Admin.**: weather forecast (기상청 단기예보, nx·ny 격자 변환)
- **사용자 갤러리 직접 업로드**: 취향 사진 수집 (Instagram Graph API는 API 한계로 미채택, 갤러리 직접 선택으로 대체)
- **Firebase FCM**: push notification

### MONITORING LAYER

- **Sentry**: error reporting, agent failure logging, session replay
- **Vercel Analytics**: web vitals, usage metrics

---

## 3. 핵심 데이터 흐름

### 미도착 감지 → 알림 플로우 (Arrival-Check Alert Flow)

경로 이탈은 자동 재계획을 트리거하지 않고, 날씨·혼잡과 동일하게 "알림"만 보낸다.

```
① 일정 항목 시작 시각 도달
→ ② 현재 위치가 해당 좌표 근처(반경 임계)인지 판정
→ ③ 근처에 없으면 미도착 알림(inbox + FCM push) 발송
→ ④ 사용자가 알림 확인 → planner 로 이동해 직접 재계획 요청(선택)
```

### 재계획 플로우 (Replanning Flow, 사용자 확인 후)

미도착·날씨·혼잡 알림 확인, 또는 대안 팝업에서 사용자가 재계획을 요청했을 때만 실행된다.

```
① 사용자 재계획 요청 (trigger: deviation / weather / manual, 범위: 전체 or 일부 일차)
→ ② BullMQ replanning job 등록
→ ③ Tool Orchestration queries maps / weather / routes
→ ④ Local LLM generates alt. itinerary
→ ⑤ Constraint Engine validates
→ ⑥ WebSocket / FCM pushes plan
```

### 취향 분석 파이프라인

```
이미지 업로드 (사용자 갤러리에서 직접 선택)
→ Vision Preference Analyzer (GPT-4o Vision / Triton)
→ Taste Tag Extraction (Food·Mood·Nature-City)
→ pgvector 임베딩 저장
→ 일정 생성 시 RAG + CRAG로 프롬프트 주입
```

### CRAG 검색 보정 구조

```
pgvector 유사도 검색
→ Retrieval Evaluator (confidence 평가)
→ confidence 낮으면 외부 tool fallback + reranking
→ 90% 이상 보정 또는 제거
→ 검증된 후보만 LLM 컨텍스트에 주입
```

---

## 4. NestJS 모듈 구조 및 경계

```
src/
├── auth/           # 카카오 OAuth + 이메일 가입·로그인·인증·재설정, JWT·Passport, 토큰 발급·회전
├── users/          # 사용자 CRUD
├── trips/          # 여행 생성·조회·수정·삭제
├── itinerary/      # 일정 항목 관리
├── preferences/    # 취향 설정 저장
├── replanning/     # 재계획 요청 수신, BullMQ 잡 등록
├── realtime/       # Realtime Events 모듈
├── notification/   # FCM 푸시 발송 (공통 유틸)
│
├── planner/        # PlannerModule ★ 핵심 도메인
│   ├── planner.service.ts         # LLM 오케스트레이션, 일정 생성·수정
│   ├── helpers/
│   │   ├── weather.helper.ts      # 기상청 API 조회, 격자 변환, 동선 조정
│   │   ├── route.helper.ts        # 카카오 길찾기 API, ETA 계산
│   │   ├── preference.helper.ts   # pgvector 취향 임베딩 RAG 조회
│   │   └── schedule.constraint.ts # 취침·기상 시간 제약 적용
│   └── constraint/
│       └── constraint.engine.ts   # 영업시간·이동시간·경로 검증 루프
│
├── alternative/    # AlternativeModule (독립 도메인)
│   ├── alternative.controller.ts  # 경로 이탈 이벤트 수신
│   ├── alternative.processor.ts   # BullMQ Worker
│   └── alternative.gateway.ts     # WebSocket push
│
└── preference-analyzer/  # PreferenceModule (독립 도메인, 온보딩 단계)
    ├── vision.analyzer.ts         # 이미지 분석, Taste Tag 추출
    └── embedding.service.ts       # pgvector 임베딩 저장
```

**모듈 분리 기준**

- **독립 Module**: 트리거가 Planner와 다른 것 (PreferenceModule=온보딩, AlternativeModule=경로 이탈 이벤트, NotificationModule=공통 유틸)
- **PlannerModule 내부 Helper**: Planner가 일정 생성·수정할 때만 호출되는 것 (Weather·Route·Preference·ScheduleConstraint)

---

## 5. 기술 스택

### Frontend

- **React Native** (WebView wrapper, FCM, Location)
- **Next.js** (App Router, SSR, WebView 내 웹앱)
- Deployed on **Vercel**

### Backend

- **NestJS** (모노레포: Turborepo + pnpm workspace)
- `packages/types`: 공통 DTO·타입 (FE·BE 공유)
- `packages/utils`: 기상청 격자 변환 등 공통 유틸

### AI / ML

- **Local LLM**: Gemma 4 + llama.cpp (MVP) → vLLM (확장)
- **Triton Inference Server**: vision·embedding·reranking 보조 모델
- **OpenAI-compatible API**: 인터페이스 통일
- **LLM Harness**: 고정 시나리오 20개 회귀 테스트, pass rate 90% 목표
- **RAGAS** 방법론 축소 적용 (context relevance·faithfulness)

### Data

- **PostgreSQL 16** + **pgvector** (벡터 DB 통합)
  - Docker 이미지: `pgvector/pgvector:pg16` (일반 postgres 이미지 사용 금지)
- **Redis** + **BullMQ** (캐시·세션·잡 큐 통합)
- **Object Storage** (로컬: MinIO, 라이브: Cloudflare R2)
  - S3 호환 API, 환경변수로 엔드포인트만 전환

### Infra / DevOps

- **Docker Compose** (로컬 개발: PostgreSQL, Redis, MinIO)
- **Nginx** (라이브 전용: SSL 터미네이션, WebSocket 업그레이드 헤더 처리)
- **Sentry** (에러·agent failure 모니터링)
- **Vercel Analytics** (web vitals)

---

## 6. 외부 API 연동 상세

| 분류        | API                           | 용도                                  | 비고                    |
| ----------- | ----------------------------- | ------------------------------------- | ----------------------- |
| 지도·렌더링 | 카카오맵 JS SDK               | 지도 렌더링, 마커, 길찾기 UI          | 웹뷰(Next.js) 내 로드   |
| 장소 검색   | 카카오 로컬 API               | 키워드 장소 검색, 좌표 반환           |                         |
| 경로·ETA    | 카카오 모빌리티 길찾기        | 자동차 경로, 실시간 교통              | `KAKAO_REST_API_KEY` 공용 |
| 대중교통    | ODsay                         | 대중교통 경로, 버스·지하철            | Referer 헤더 필수       |
| 도보        | (외부 API 없음)               | 직선거리 기반 로컬 추정               | `RouteHelper` 내부 계산 |
| 관광정보    | 한국관광공사 국문 관광정보    | 관광지 기본정보, 영업시간, 좌표       | 수집→임베딩해 pgvector 적재 + 영업시간 보강(Constraint Engine) |
| 관광정보    | ~~한국관광공사 연관 관광지~~  | (미채택)                              | "이 여행지 다음에 저 여행지 많이 감" 식의 일반 통계라 사용자 취향 기반 추천 성격과 맞지 않음. 대안 후보는 pgvector(KTO 관광정보+카카오 로컬 적재 풀)의 취향 유사도 검색으로 대체 |
| 관광정보    | 한국관광공사 관광지 집중률(방문자 추이 예측) | 혼잡 예상 시 일정 변경 "추천" 알림 | `TatsCnctrRateService`. areaCd/signguCd=법정동 코드(ldongCode2 로 조달), tAtsNm(관광지)만 데이터. **플래닝 점수에는 미반영** — 취향을 흐릴 수 있어 날씨 알림과 동일하게 inbox 추천(`crowd_alert`)만, 자동 재계획 안 함 |
| 인기도      | 네이버 블로그·카페 검색(NCP API Hub) | "OO 여행지 추천" 글의 후보 언급 빈도 → 대중 인지도 재랭킹 | `NaverSearchService`. 취향만 보면 마이너 장소가 많이 나와 앞단에 붙인 신호. **플래닝 점수에 popularity 0.12 가중(집중률과 달리 반영)**, 단 소프트 재랭킹(마이너 후순위, 제거 아님)이고 키 없으면 중립값으로 랭킹 불변 |
| 날씨        | 기상청 단기예보               | 날씨·강수 예보 (최대 5일)             | nx·ny 격자 변환 필수    |
| 인증        | 카카오 OAuth 2.0              | 로그인, JWT 발급                      | `state` 필수(아래 주의사항) |
| 이미지      | 사용자 갤러리 직접 업로드     | 취향 사진 수집                        | Instagram Graph API는 API 한계로 미채택 |
| 푸시        | Firebase FCM + APNs           | 재계획·날씨 추천 푸시 알림            | notifee 라이브러리 조합 |

**길찾기 API 주의사항**

- ODsay 는 키 발급 시 등록한 서비스 URL 을 `Referer` 헤더로 검증한다. 헤더가 없으면 HTTP 200 + `[ApiKeyAuthFailed]` 로 실패하므로 `ODSAY_SERVICE_URL` 을 등록 도메인과 정확히 일치시켜야 한다 (로컬 `http://localhost:4000`)
- 카카오 모빌리티·ODsay 모두 **길찾기 실패를 HTTP 200 본문으로 반환**한다 (카카오 `routes[].result_code`, ODsay `error[]`). axios 가 던지지 않으므로 catch 로는 안 잡히고, 응답 본문을 직접 검사해야 한다
- 카카오 모빌리티 `origin`/`destination` 은 `x,y` = **경도,위도** 순서. `summary.duration`=초, `summary.distance`=미터
- ODsay `totalTime`=분, `totalDistance`=**미터** (km 아님)
- 경로 조회 실패 시 `RouteHelper` 는 직선거리 기반 추정치로 조용히 폴백한다. 이동시간이 이상하면 폴백을 타고 있는지부터 확인할 것
- 이동 수단 분기는 표시용 라벨이 아니라 정본 `RouteMode`('walk'|'transit'|'car')로 한다

**카카오 OAuth 주의사항**

- 로그인 시작(`GET /auth/kakao`)과 콜백은 **같은 오리진**이어야 한다. `state` 를 httpOnly 쿠키로 브라우저에 묶어 콜백에서 대조하는데, 웹이 상대경로(`/api/v1/...`)로 시작하면 Next 프록시 오리진에서 출발하고 카카오는 `KAKAO_CALLBACK_URL`(API 오리진)로 돌려보내 쿠키가 안 실린다. 그래서 서버가 `KAKAO_CALLBACK_URL` 에서 파생한 절대 `startUrl` 을 `/auth/kakao/status` 로 내려주고 웹은 그걸로 이동한다 — 로컬은 포트가 달라도 쿠키가 공유돼 우연히 통과하니, 이 경로를 바꿀 땐 배포 기준으로 판단할 것
- 로그인 결과는 URL 에 세션이 아니라 **1회용 교환 코드**(Redis, 120초)만 싣는다. 웹이 `POST /auth/kakao/exchange` 로 바꿔 간다
- 상세: [docs/auth/account-security-hardening-v1.md](docs/auth/account-security-hardening-v1.md)

**기상청 API 주의사항**

- 위도·경도 → nx·ny 격자 좌표 변환 필수 (`packages/utils/grid-converter.ts`)
- base_time: 02·05·08·11·14·17·20·23시 발표, 발표 후 10분 지연 여유 필요
- PCP 필드: "강수없음", "1mm 미만" 등 문자열로 올 수 있어 파싱 예외처리 필수

**네이버 검색 API 주의사항**

- **NCP API Hub 경유** (`naverapihub.apigw.ntruss.com/search/v1/{blog,cafearticle}`) — 구 `openapi.naver.com` 아님. 인증은 `X-NCP-APIGW-API-KEY-ID`(Client ID) + `X-NCP-APIGW-API-KEY`(Secret) **헤더** (`NAVER_SEARCH_CLIENT_ID`/`_SECRET`)
- 응답 `items[].title`/`description` 은 검색어가 `<b>` 로 강조돼 온다 — 태그·HTML 엔티티 제거 후 코퍼스화
- 매칭은 **역방향**: 블로그에서 장소명 추출(불안정한 한글 NER)이 아니라, 깨끗한 후보 `name` 이 코퍼스에 몇 번 나오는지 카운트. 정식명이 블로그 표현보다 길면(예 '국립경주박물관' vs '경주박물관') 기관 수식어(국립·도립·시립·공립·사립) 뗀 코어로 폴백
- 목적지 어간은 **서브지역까지 보존**(`regionSearchStem`, '부산 해운대'≠'부산 광안리'). 목적지별 코퍼스는 6h TTL 캐시. 블로그·카페 중 한쪽 실패해도 나머지 코퍼스 유지(`allSettled`)
- 인지도 감점은 **순위만 낮추고 후보를 탈락(제거)시키지 않는다** — accept 게이트(`minimumConfidence`)에서 중립값 아래 감점분을 되돌려 소프트 재랭킹 보장

## 7. 개발 시 주의사항

- PostgreSQL 이미지는 반드시 `pgvector/pgvector:pg16` 사용 (일반 `postgres:16` 사용 금지)
- **익명·공유 세션은 없다.** 인증 없이 세션을 내주던 `POST /auth/demo`(모든 방문자가 계정 하나를 공유)는 제거했다. 데모·시드·드라이버는 전부 실제 계정으로 로그인한다 (`seed:demo-live` 는 `SEED_USER_EMAIL`)
- **`JWT_SECRET`·`JWT_REFRESH_SECRET` 은 프로덕션에서 필수**다. 미설정이거나 `.env.example` 의 `change-me-*` 값 그대로면 부팅이 거부된다 (`common/jwt-secrets`)
- **기존 계정에 비밀번호를 심는 경로를 만들지 말 것.** 가입 요청이 이미 있는 이메일로 오면 계정을 건드리지 않고 주인에게 안내 메일만 보낸다 — 인증 링크는 계정 주인에게 가므로, 대기 비밀번호를 심어 두면 주인이 링크를 누르는 순간 계정이 넘어간다. 기존 계정의 비밀번호 설정·변경은 재설정 플로우만 통한다
- **메일을 보내는 라우트에는 주소별 한도(`EmailSendLimiterService`)를 붙인다.** 라우트의 `@Throttle` 은 IP 기준이라 IP 를 갈아 가며 한 주소로 메일을 몰 수 있다. 가입도 메일 라우트이므로 재발송과 **같은 `verify` 버킷**을 쓴다 — 버킷이 갈리면 가입으로 재발송 한도를 우회한다
- **인증 대기 비밀번호·닉네임은 계정이 아니라 인증 토큰에 싣는다** (`email_tokens.pendingPasswordHash`/`pendingNickname`). 계정에 대기 칸을 두면 같은 이메일로 들어온 여러 가입 신청이 그 칸을 두고 다퉈, 링크를 누른 사람이 신청하지 않은 값이 켜진다
- **프로덕션은 실제 발송 가능한 이메일 설정이 없으면 부팅을 거부한다** (`EMAIL_TRANSPORT=resend`+`RESEND_API_KEY` 또는 `smtp`+`SMTP_HOST`). console 폴백은 응답 200·메일 0통·에러 로그도 없는 조용한 사고다
- 위 세 항목의 근거·공격 시나리오·검증: [docs/auth/email-delivery-hardening-v1.md](docs/auth/email-delivery-hardening-v1.md)
- WebSocket 업그레이드 헤더(`Upgrade`, `Connection`)는 Nginx에서 별도 처리 필요
- Geolocation(`navigator.geolocation`)은 HTTPS 환경에서만 동작, 로컬은 `localhost` 예외
- Android WebView에서 geolocation 이중 권한 처리 필요 (`onPermissionRequest` prop)
- 취향 사진은 사용자 갤러리에서 직접 선택·업로드로 수집 (Instagram Graph API는 API 한계·앱 검수 리스크로 미채택)
- 경로 이탈(미도착)도 날씨·혼잡과 동일하게 자동 재계획 없이 "알림"만 한다. `ArrivalAlertModule`(5분 주기 스캔)이 이동 중 연속 이탈 판정 대신 **각 일정 항목의 시작 시각+유예(15분)에 사용자 최신 위치가 그 좌표 반경(500m) 밖이면** `arrival_alert` inbox + FCM 알림을 보낸다. 판정은 서버가 하며, 클라이언트는 진행 중 위치를 `POST /live/location`(`LiveLocationService`, Redis 캐시)으로 주기 보고한다. 위치 없음/오래됨(10분↑)이면 판정 스킵, 알림은 (여행·사용자·일차)당 1회. 클릭 시 planner 로 이동해 사용자가 직접 재계획 — 이때 `ReplanningService` 가 같은 위치 캐시를 재계획 잡에 실어 후보 검색을 현재 위치 앵커로 돌린다(`deviation` 트리거만, 신선도 10분 + 대상 일차 장소에서 30km 이내). 위치 캐시는 `LiveLocationModule`(arrival-alert 폴더) 이 소유해 두 도메인이 공유한다. 배너 confirm 을 눌러야 신고되던 web 연속 이탈 감지(semi-manual)를 대체한다. 위치 보고 주체는 실행 환경으로 갈린다 — **브라우저 단독이면 웹**이 직접 보고하고, **RN 앱이면 네이티브**(App.tsx)가 foreground service 로 잡은 위치를 포그라운드·백그라운드 모두 직접 POST 한다(웹뷰 JS 는 백그라운드에서 멈추므로). RN 에선 웹이 인증정보(access token + 절대 API base)만 `LOCATION_AUTH` 브리지로 네이티브에 넘기고 자체 보고는 하지 않는다. access token TTL 이 7일이라 여행 세션 동안 리프레시 없이 유효
- 재계획은 **일자 단위 부분 재계획**을 지원한다. `ReplanRequestDto.targetDays`(1-based, 생략 시 전체)로 지정한 일차만 다시 생성하고 나머지 일차는 저장된 항목을 그대로 둔다(`ItineraryService.replaceDayItems` 가 대상 일차만 삭제→삽입, 한 트랜잭션). AI 플래너에는 대상 일차 수만큼(1..N)만 계획하게 하고 결과를 실제 일차 번호로 되돌리며, 유지되는 일차에 이미 있는 장소는 후보에서 제외해 일차 간 중복 배치를 막는다. 웹 재계획 모달의 "재계획 범위"에서 고르고, 기본값은 보고 있던 일차(알림 딥링크 `?day=` 포함)
- **오늘(KST)에 해당하는 일차는 "지금 이후"만 다시 짠다**(`resolveDayAnchors`). 시작은 지금+10분(방문 중 항목이 있으면 그 종료 후)이고 첫 항목엔 현재 위치→장소 이동시간을 더하며, 검색 `startAt`·LLM 프롬프트(`dayStartTimes`·`dayItemTargets`)·항목 수 상한(`itemsFittingRemaining`, 강도별 최소치 미보장)이 모두 남은 활동 시간을 따른다. 이미 끝난 항목은 그대로 남기고(진행 중 항목은 사용자가 그 좌표 반경 안일 때만) 후보에서도 제외한다. 남은 시간에 한 곳도 못 담는 일차는 손대지 않는다 — 아침부터 다시 채우면 지난 시각에 일정이 박히고, 남은 시간을 무시하고 하루치를 밀어넣으면 제약 검증이 실패해 요청이 죽는다
- 날씨 변화는 자동 재계획을 트리거하지 않고 일정 조정을 "추천"(inbox 알림)만 한다. 실제 재계획은 사용자가 확인 후 수동 요청 (`trigger: 'weather'`)
- 관광지 혼잡(집중률)도 날씨와 동일하게 자동 재계획 없이 "추천"만 한다. `CrowdAlertModule`(하루 1회 스캔)이 여행 일정 관광지의 예측 집중률이 그 장소 평균 대비 높은 날을 찾아 `crowd_alert` inbox 알림을 보낸다. 클릭 시 planner 로 이동해 사용자가 직접 재계획. **집중률은 일정 생성/재계획 점수에는 넣지 않는다**(취향 신호를 흐릴 수 있음)
- 후보 검색·적재 카탈로그의 결정·근거·검증은 문서로 분리했다 — [docs/preference/destination-anchor-retrieval-v1.md](docs/preference/destination-anchor-retrieval-v1.md)(행정구역으로 안 잡히는 목적지의 좌표 앵커 반경 검색), [docs/preference/catalog-ingestion-gates-v1.md](docs/preference/catalog-ingestion-gates-v1.md)(KTO 쇼핑 소매 점포·축제 기간·적재 게이트), [docs/preference/retrieval-eval-harness-hardening-v1.md](docs/preference/retrieval-eval-harness-hardening-v1.md)(골든셋 교정·인지도 판정 게이트·측정 방법론), [docs/preference/kakao-source-enrichment-v1.md](docs/preference/kakao-source-enrichment-v1.md)(카카오 앵커를 카탈로그 좌표로 채움·프랜차이즈 지점 후보 제외), [docs/preference/kakao-category-search-ceiling-v1.md](docs/preference/kakao-category-search-ceiling-v1.md)(카카오 카테고리 검색 45건 상한·앵커 격자를 반경에 묶음), [docs/preference/candidate-pool-dining-ceiling-v1.md](docs/preference/candidate-pool-dining-ceiling-v1.md)(후보 풀 식음 상한 0.375), [docs/preference/popularity-saturation-and-pool-size-v1.md](docs/preference/popularity-saturation-and-pool-size-v1.md)(인지도 포화 해소·풀 배수 40), [docs/preference/landmark-name-absorption-v1.md](docs/preference/landmark-name-absorption-v1.md)(앞머리 토큰이 남의 인지도를 물려받던 통로 차단), [docs/preference/keyword-ingest-source-v1.md](docs/preference/keyword-ingest-source-v1.md)(`keyword` 적재 소스·`popular` 서브지역 패스)
- 네이버 인기도(popularity)는 집중률·날씨와 달리 **일정 생성/재계획 점수에 반영한다**(CRAG 가중 0.12, `PlaceRetrievalService`가 앞단에서 `NaverSearchService` 인지도 인덱스를 주입). 취향만 보면 마이너 장소가 많이 나오는 걸 보정하려는 것 — 단 취향 개인화(pgvector)를 죽이지 않도록 소프트 재랭킹이며, 후보를 제거하지 않고 마이너를 후순위로만 민다
- 모든 외부 API는 추상화된 이름(Object Storage, 지도 API 등)으로 인터페이스 설계, 특정 서비스 교체 시 환경변수만 변경
- BullMQ Worker: `attempts: 3`, `backoff: 2000` 재시도 설정 기본 적용
