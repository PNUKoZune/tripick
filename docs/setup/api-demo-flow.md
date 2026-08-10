# TriPick backend demo flow

기준 브랜치: `develop`
작성일: 2026-05-06
검증 일시: 2026-05-06
기준 API base URL: `http://localhost:4000/api/v1`

## 1. 목적

아래 순서로 backend 핵심 수직 slice를 로컬에서 재현할 수 있다.

- 계정 준비 + 로그인
- 취향 저장
- 여행 생성 + mock/rule-based itinerary 생성
- 일정 조회
- 재계획 이벤트 enqueue (`waiting`)

외부 연동 없이도 동작하도록 일부 fallback이 들어가 있다.

- `DATABASE_URL` 미설정 시 로컬 Postgres fallback 사용
- `JWT_SECRET` 미설정 시 개발용 fallback 사용 (**`NODE_ENV=production` 에서는 부팅 거부** → [`docs/auth/account-security-hardening-v1.md`](../auth/account-security-hardening-v1.md) §4.6)
- TMAP/KMA API 키 미설정 시 route/weather fallback 사용

## 2. 선행 실행

```bash
corepack enable
pnpm install
pnpm db:up
pnpm --filter @tripick/types build
pnpm --filter @tripick/utils build
pnpm --filter @tripick/api typecheck
pnpm --filter @tripick/api dev
```

정상 부팅 후 API는 `http://localhost:4000/api/v1`에서 응답한다.
이미 4000 포트를 다른 API 프로세스가 점유 중이면 `PORT=4100 pnpm --filter @tripick/api dev`처럼 대체 포트로 띄워도 된다.

## 3. 샘플 payload

### 3-1. 계정 준비 + 로그인

인증 없이 세션을 내주던 `POST /auth/demo` 는 제거됐다(모든 방문자가 계정 하나를 공유하던 구멍 —
[`docs/auth/account-security-hardening-v1.md`](../auth/account-security-hardening-v1.md) §4.1).
데모용 계정도 일반 계정으로 만들어 쓴다. 최초 1회만:

```bash
curl -s -X POST http://localhost:4000/api/v1/auth/signup \
  -H 'content-type: application/json' \
  -d '{"email":"demo@tripick.test","password":"demo12345","nickname":"데모"}'

# 인증 링크의 raw 토큰은 메일(console 로그)에만 있고 DB 엔 hash 만 남는다.
# 로컬에서는 인증 완료 상태를 직접 세우는 게 빠르다.
docker compose exec -T postgres psql -U tripick -d tripick -c \
  'UPDATE users SET "emailVerifiedAt"=now(), "passwordHash"="pendingPasswordHash", "pendingPasswordHash"=NULL WHERE email=$$demo@tripick.test$$;'
```

이후 로그인:

```bash
curl -s -X POST http://localhost:4000/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"demo@tripick.test","password":"demo12345"}'
```

응답에서 `tokens.accessToken`을 이후 Bearer 토큰으로 사용한다.

### 3-2. 취향 저장

```bash
curl -s -X PUT http://localhost:4000/api/v1/preferences \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "tasteTags": {
      "food": ["korean", "cafe"],
      "mood": ["healing"],
      "environment": ["city"],
      "confidence": 0.92
    }
  }'
```

### 3-3. 여행 생성

```bash
curl -s -X POST http://localhost:4000/api/v1/trips \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "title": "서울 1박 2일 데모",
    "destination": "서울",
    "startDate": "2026-05-10",
    "endDate": "2026-05-11",
    "wakeTime": "08:30",
    "sleepTime": "22:30",
    "transportMode": "transit"
  }'
```

정상 응답이면 trip status는 `confirmed`이고, planner가 itinerary item들을 함께 저장한다.

### 3-4. 일정 조회

```bash
curl -s http://localhost:4000/api/v1/trips/$TRIP_ID/itinerary \
  -H "authorization: Bearer $ACCESS_TOKEN"
```

검증 기준 예시:
- 아이템 개수 1개 이상
- 첫 장소 `scheduledAt`이 `openingHours` 범위 안에 있음
- 데모 검증 케이스에서는 8개 itinerary item 생성 확인

### 3-5. 재계획 이벤트 enqueue

```bash
curl -s -X POST http://localhost:4000/api/v1/alternative/waiting \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "tripId": "'$TRIP_ID'",
    "trigger": "manual",
    "waitingMinutes": 20
  }'
```

컨트롤러에서 `trigger`는 강제로 `waiting`으로 덮어쓴다. 응답은 `jobId`, `tripId`, `status=pending` 형태다.

## 4. 2026-05-06 실제 검증 결과

당시 기록이다. 1번은 그 뒤 `POST /auth/demo` 가 제거돼 §3-1 의 가입·로그인으로 대체됐고, 나머지 단계는 그대로다.

1. `POST /auth/demo` -> 200 *(현재는 `POST /auth/login`)*
2. `PUT /preferences` -> 200
3. `POST /trips` -> 201, `status=confirmed`
4. `GET /trips/:tripId/itinerary` -> 200, `itinerary_count=8`
5. `POST /alternative/waiting` -> 201, BullMQ job enqueue 확인
6. 같은 API 프로세스 안의 worker가 replan job을 소비한 뒤 `GET /trips/:tripId/itinerary` 재조회 시 첫 itinerary item이 `성수 감도 카페` -> `성수 서울숲`으로 바뀌는 것 확인

추가 확인:
- 첫 itinerary item `성수 감도 카페`의 `scheduledAt=2026-05-09T01:00:00.000Z` (`KST 10:00`)로 보정되어 opening hours `10:00-22:00` 제약을 통과함

## 5. 알려진 제한

- planner는 실제 장소 검색 API 대신 seed 데이터 + rule-based scheduling을 사용한다.
- 재계획 worker는 로컬 dev에서 같은 API 프로세스 안에서 소비되는 시나리오까지만 확인했다. 별도 worker 분리 배포, WebSocket 클라이언트 실시간 수신, FCM 푸시는 아직 별도 검증이 필요하다.
- 취향 분석 업로드 엔드포인트는 구조만 정리했으며, 실제 vision/embedding 품질은 외부 모델 설정에 의존한다.
- 서울/KST 중심으로 시간 제약을 다뤄서 다국가/다중 timezone 여행에는 아직 일반화돼 있지 않다.
