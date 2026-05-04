# TriPick (트리픽) — 프로젝트 컨텍스트

> **Trip + Pick**: 취향으로 골라주는 AI 여행 플래너 에이전트

---

## 1. 서비스 개요

사용자의 이미지 취향 분석과 실시간 맥락(웨이팅·경로 이탈·날씨)을 반영하여 국내 여행 일정을 자동 생성·재계획하는 AI 에이전트 서비스. React Native 앱(Next.js WebView) + NestJS 백엔드 + 프라이빗 LLM 추론 인프라로 구성.

---

## 2. 시스템 아키텍처 레이어 구조

### CLIENT LAYER

- **React Native Mobile App**
  - Location Tracking, Trip Progress, Waiting Report
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

- **Planner Agent Orchestrator**
  - Tool Router: 외부 tool 호출 라우팅
  - Local LLM Call: LLM 추론 실행
  - Prompt Templates: 시나리오별 템플릿 관리
  - JSON Plan Generator: 일정 JSON 생성
  - Constraint Validation Loop: 제약 조건 반복 검증
  - _"Coordinates tools, LLM and constraints to produce a valid itinerary."_

- **Local LLM Serving ★** (프라이빗 추론 인프라)
  - MVP: Gemma 4 + llama.cpp / vLLM
  - 보조 모델: NVIDIA Triton Inference Server (vision·embedding·reranking)
  - OpenAI-compatible API 인터페이스
  - Itinerary Reasoning / Alternative Plan Explanation
  - session/cache: Redis 연동

- **Vision Preference Analyzer**
  - Instagram Photo Analysis
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
- **Object Storage**: Instagram photos, extracted metadata

### EXTERNAL TOOL LAYER

- **카카오맵 / Local API**: place search, map rendering
- **Naver / Google / TMAP / ODsay**: route ETA, public transit
- **Korea Meteorological Admin.**: weather forecast (기상청 단기예보, nx·ny 격자 변환)
- **Instagram Graph API**: user media import (MVP는 직접 업로드 우선, Graph API는 추후)
- **Firebase FCM**: push notification

### MONITORING LAYER

- **Sentry**: error reporting, agent failure logging, session replay
- **Vercel Analytics**: web vitals, usage metrics

---

## 3. 핵심 데이터 흐름

### 실시간 재계획 플로우 (Realtime Replanning Flow)

```
① Waiting reported / route deviation
→ ② BullMQ replanning job 등록
→ ③ Tool Router queries maps / weather / routes
→ ④ Local LLM generates alt. itinerary
→ ⑤ Constraint Engine validates
→ ⑥ WebSocket / FCM pushes plan
```

### 취향 분석 파이프라인

```
이미지 업로드 (직접 or Instagram)
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
│   ├── alternative.controller.ts  # 웨이팅·이탈 이벤트 수신
│   ├── alternative.processor.ts   # BullMQ Worker
│   └── alternative.gateway.ts     # WebSocket push
│
└── preference-analyzer/  # PreferenceModule (독립 도메인, 온보딩 단계)
    ├── vision.analyzer.ts         # 이미지 분석, Taste Tag 추출
    └── embedding.service.ts       # pgvector 임베딩 저장
```

**모듈 분리 기준**

- **독립 Module**: 트리거가 Planner와 다른 것 (PreferenceModule=온보딩, AlternativeModule=웨이팅·이탈 이벤트, NotificationModule=공통 유틸)
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
| 경로·ETA    | TMAP API                      | 자동차 경로, 실시간 교통, 장소 혼잡도 | 국내 도로 품질 우수     |
| 대중교통    | ODsay / Naver                 | 대중교통 경로, 버스·지하철            |                         |
| 관광정보    | 한국관광공사 국문 관광정보    | 관광지 기본정보, 영업시간, 좌표       | Constraint Engine 활용  |
| 관광정보    | 한국관광공사 연관 관광지      | 재계획 대안 후보 탐색                 | AlternativeModule 활용  |
| 관광정보    | 한국관광공사 방문자 추이 예측 | 혼잡도 예측, 시간대 배치 최적화       | 향후 30일 예측          |
| 날씨        | 기상청 단기예보               | 날씨·강수 예보 (최대 5일)             | nx·ny 격자 변환 필수    |
| 인증        | 카카오 OAuth 2.0              | 로그인, JWT 발급                      |                         |
| 이미지      | Instagram Graph API           | 취향 사진 수집                        | MVP는 직접 업로드 우선  |
| 푸시        | Firebase FCM + APNs           | 재계획·날씨 변화 푸시 알림            | notifee 라이브러리 조합 |

**기상청 API 주의사항**

- 위도·경도 → nx·ny 격자 좌표 변환 필수 (`packages/utils/grid-converter.ts`)
- base_time: 02·05·08·11·14·17·20·23시 발표, 발표 후 10분 지연 여유 필요
- PCP 필드: "강수없음", "1mm 미만" 등 문자열로 올 수 있어 파싱 예외처리 필수

## 7. 개발 시 주의사항

- PostgreSQL 이미지는 반드시 `pgvector/pgvector:pg16` 사용 (일반 `postgres:16` 사용 금지)
- WebSocket 업그레이드 헤더(`Upgrade`, `Connection`)는 Nginx에서 별도 처리 필요
- Geolocation(`navigator.geolocation`)은 HTTPS 환경에서만 동작, 로컬은 `localhost` 예외
- Android WebView에서 geolocation 이중 권한 처리 필요 (`onPermissionRequest` prop)
- Instagram Graph API는 앱 검수 리스크로 MVP에서는 직접 이미지 업로드 우선 적용
- 모든 외부 API는 추상화된 이름(Object Storage, 지도 API 등)으로 인터페이스 설계, 특정 서비스 교체 시 환경변수만 변경
- BullMQ Worker: `attempts: 3`, `backoff: 2000` 재시도 설정 기본 적용
