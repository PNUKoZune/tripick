# TriPick (트리픽) — 프로젝트 컨텍스트

> **Trip + Pick**: 취향으로 골라주는 AI 여행 플래너 에이전트

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
  - Constraint Validation Loop: AI draft 검증 실패 시 후보 rotate 기반 결정적 재생성 최대 3회 (LLM 재호출 아님)
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
① 사용자 재계획 요청 (trigger: deviation / weather / manual)
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
├── auth/           # 카카오 OAuth, JWT·Passport, 토큰 발급·검증
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
| 날씨        | 기상청 단기예보               | 날씨·강수 예보 (최대 5일)             | nx·ny 격자 변환 필수    |
| 인증        | 카카오 OAuth 2.0              | 로그인, JWT 발급                      |                         |
| 이미지      | 사용자 갤러리 직접 업로드     | 취향 사진 수집                        | Instagram Graph API는 API 한계로 미채택 |
| 푸시        | Firebase FCM + APNs           | 재계획·날씨 추천 푸시 알림            | notifee 라이브러리 조합 |

**길찾기 API 주의사항**

- ODsay 는 키 발급 시 등록한 서비스 URL 을 `Referer` 헤더로 검증한다. 헤더가 없으면 HTTP 200 + `[ApiKeyAuthFailed]` 로 실패하므로 `ODSAY_SERVICE_URL` 을 등록 도메인과 정확히 일치시켜야 한다 (로컬 `http://localhost:4000`)
- 카카오 모빌리티·ODsay 모두 **길찾기 실패를 HTTP 200 본문으로 반환**한다 (카카오 `routes[].result_code`, ODsay `error[]`). axios 가 던지지 않으므로 catch 로는 안 잡히고, 응답 본문을 직접 검사해야 한다
- 카카오 모빌리티 `origin`/`destination` 은 `x,y` = **경도,위도** 순서. `summary.duration`=초, `summary.distance`=미터
- ODsay `totalTime`=분, `totalDistance`=**미터** (km 아님)
- 경로 조회 실패 시 `RouteHelper` 는 직선거리 기반 추정치로 조용히 폴백한다. 이동시간이 이상하면 폴백을 타고 있는지부터 확인할 것
- 이동 수단 분기는 표시용 라벨이 아니라 정본 `RouteMode`('walk'|'transit'|'car')로 한다

**기상청 API 주의사항**

- 위도·경도 → nx·ny 격자 좌표 변환 필수 (`packages/utils/grid-converter.ts`)
- base_time: 02·05·08·11·14·17·20·23시 발표, 발표 후 10분 지연 여유 필요
- PCP 필드: "강수없음", "1mm 미만" 등 문자열로 올 수 있어 파싱 예외처리 필수

## 7. 개발 시 주의사항

- PostgreSQL 이미지는 반드시 `pgvector/pgvector:pg16` 사용 (일반 `postgres:16` 사용 금지)
- WebSocket 업그레이드 헤더(`Upgrade`, `Connection`)는 Nginx에서 별도 처리 필요
- Geolocation(`navigator.geolocation`)은 HTTPS 환경에서만 동작, 로컬은 `localhost` 예외
- Android WebView에서 geolocation 이중 권한 처리 필요 (`onPermissionRequest` prop)
- 취향 사진은 사용자 갤러리에서 직접 선택·업로드로 수집 (Instagram Graph API는 API 한계·앱 검수 리스크로 미채택)
- 경로 이탈(미도착)도 날씨·혼잡과 동일하게 자동 재계획 없이 "알림"만 한다. `ArrivalAlertModule`(5분 주기 스캔)이 이동 중 연속 이탈 판정 대신 **각 일정 항목의 시작 시각+유예(15분)에 사용자 최신 위치가 그 좌표 반경(500m) 밖이면** `arrival_alert` inbox + FCM 알림을 보낸다. 판정은 서버가 하며, 클라이언트는 진행 중 위치를 `POST /live/location`(`LiveLocationService`, Redis 캐시)으로 주기 보고한다. 위치 없음/오래됨(10분↑)이면 판정 스킵, 알림은 (여행·사용자·일차)당 1회. 클릭 시 planner 로 이동해 사용자가 직접 재계획. 배너 confirm 을 눌러야 신고되던 web 연속 이탈 감지(semi-manual)를 대체한다. 위치 보고 주체는 실행 환경으로 갈린다 — **브라우저 단독이면 웹**이 직접 보고하고, **RN 앱이면 네이티브**(App.tsx)가 foreground service 로 잡은 위치를 포그라운드·백그라운드 모두 직접 POST 한다(웹뷰 JS 는 백그라운드에서 멈추므로). RN 에선 웹이 인증정보(access token + 절대 API base)만 `LOCATION_AUTH` 브리지로 네이티브에 넘기고 자체 보고는 하지 않는다. access token TTL 이 7일이라 여행 세션 동안 리프레시 없이 유효
- 날씨 변화는 자동 재계획을 트리거하지 않고 일정 조정을 "추천"(inbox 알림)만 한다. 실제 재계획은 사용자가 확인 후 수동 요청 (`trigger: 'weather'`)
- 관광지 혼잡(집중률)도 날씨와 동일하게 자동 재계획 없이 "추천"만 한다. `CrowdAlertModule`(하루 1회 스캔)이 여행 일정 관광지의 예측 집중률이 그 장소 평균 대비 높은 날을 찾아 `crowd_alert` inbox 알림을 보낸다. 클릭 시 planner 로 이동해 사용자가 직접 재계획. **집중률은 일정 생성/재계획 점수에는 넣지 않는다**(취향 신호를 흐릴 수 있음)
- 모든 외부 API는 추상화된 이름(Object Storage, 지도 API 등)으로 인터페이스 설계, 특정 서비스 교체 시 환경변수만 변경
- BullMQ Worker: `attempts: 3`, `backoff: 2000` 재시도 설정 기본 적용
