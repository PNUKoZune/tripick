# TriPick local setup / 실행 검증

최종 확인 기준 브랜치: `develop`
기준 상태: `git branch --show-current` -> `develop`, `git rev-list --left-right --count main...develop` -> `0 2`
검증 일시: 2026-05-06

## 1. 현재 실행 결론

- 인프라(Postgres/Redis/MinIO): 로컬 Docker Compose로 정상 기동됨
- Web (`apps/web`): `pnpm dev`에서 `http://localhost:3000`까지 정상 부팅됨
- API (`apps/api`): `pnpm --filter @tripick/api typecheck` 통과, `pnpm --filter @tripick/api dev`로 부팅 가능, demo auth -> preferences -> trips -> itinerary -> waiting replan 최소 플로우 검증 완료
- Mobile (`apps/mobile`): root `pnpm dev` 대상이 아니며, 단독 `pnpm --filter @tripick/mobile start` 실행 시 Metro config 부재로 실패

즉, develop은 이제 "웹 + 인프라 + backend demo slice"까지 바로 검증 가능하고, 주된 blocker는 mobile 스타트업 부재와 web/mobile 잔여 타입 안정성이다.

## 2. 재현 커맨드

```bash
corepack enable
pnpm install
pnpm db:up
pnpm dev
```

추가 확인:

```bash
pnpm --filter @tripick/api typecheck
pnpm --filter @tripick/web typecheck
pnpm --filter @tripick/mobile typecheck
pnpm --filter @tripick/mobile start
```

## 3. 포트 / 엔드포인트

- Web: `3000`
- API: `4000` (`/api/v1`, Swagger는 dev에서 `/api/docs`)
- PostgreSQL: `5432`
- Redis: `6379`
- MinIO S3 API: `9000`
- MinIO Console: `9001`
- Mobile dev WebView 기본 URL: `http://10.0.2.2:3000`

## 4. 필요한 env 키

### API

- `DATABASE_URL`
- `REDIS_HOST` (기본값 `localhost`)
- `REDIS_PORT` (기본값 `6379`)
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `JWT_EXPIRES_IN` (기본값 `7d`)
- `JWT_REFRESH_EXPIRES_IN` (기본값 `30d`)
- `KAKAO_REST_API_KEY`
- `KAKAO_CLIENT_SECRET` (카카오 앱에서 client secret을 켠 경우에만 입력)
- `KAKAO_CALLBACK_URL`
- `WEB_APP_URL` (카카오 OAuth 성공/실패 후 돌아갈 웹 앱 origin, 기본값 `http://localhost:3000`)
- `CORS_ORIGIN` (기본값 `http://localhost:3000`)
- `PORT` (기본값 `4000`)
- `LLM_BASE_URL` (기본값 `http://localhost:8080/v1`)
- `LLM_MODEL` (기본값 `gemma-4`)
- `LLM_API_KEY` (기본값 `local`)

### Web

- `NEXT_PUBLIC_API_URL` (기본값 `http://localhost:4000/api/v1`)
- `NEXT_PUBLIC_WS_URL` (웹소켓 base URL)
- `NEXT_PUBLIC_KAKAO_MAP_KEY`

### Mobile

- 별도 `.env` 읽기 구조는 아직 없고, 소스코드 상 WebView URL이 하드코딩되어 있음
- dev: `http://10.0.2.2:3000`
- prod: `https://tripick.vercel.app`

## 5. 실제 실패 지점

### API

이전 develop blocker였던 TypeScript 오류는 현재 정리돼 `pnpm --filter @tripick/api typecheck`와 `pnpm --filter @tripick/api dev`가 통과한다.

현재 기준에서 API 쪽 잔여 제한은 아래다.

- planner는 seed 데이터 + rule-based scheduling을 사용하므로 외부 지도/날씨/LLM 품질 검증은 아직 별도 작업이 필요하다.
- replan worker는 로컬 dev에서 같은 API 프로세스 안에서 처리되는 흐름까지만 확인했다.
- Kakao OAuth 실서비스 env/callback 검증은 v1 blocker에서 제외돼 있다.

### Web

현재 기준에서 웹은 타입체크와 프로덕션 빌드가 모두 통과한다.

- `pnpm --filter @tripick/web typecheck` → 통과
- `pnpm --filter @tripick/web build` → 통과
- `apps/web/src/app/page.tsx` 기준으로 랜딩 → 취향 입력 → 여행 조건 입력 → 결과 → 재계획 UI가 단일 모바일 컬럼으로 연결됨
- `apps/web/src/lib/api.ts`, `apps/web/src/lib/socket.ts`, `apps/web/next.config.mjs` 조합으로 demo auth / REST / realtime 재계획 흐름을 로컬 API에 연결 가능함

즉, 웹은 이제 landing prototype 수준이 아니라 데모 가능한 v1 플로우를 갖췄고, 남은 리스크는 브라우저 상호작용 최종 검증과 모바일 WebView 연동 쪽이다.

### Mobile 실패

1. `pnpm --filter @tripick/mobile typecheck`
   - `@react-native/typescript-config/tsconfig.json`를 찾지 못함
   - TypeScript 6에서 `baseUrl` deprecation 에러가 추가로 발생

2. `pnpm --filter @tripick/mobile start`
   - `error No Metro config found in /tmp/tripick/apps/mobile.`

즉, 모바일은 현재 개발 진입점 자체가 미완성이다.

## 6. 우회 가능 여부

### 바로 가능한 것

- Web landing/prototype 작업
- Docker 기반 로컬 데이터 계층 확인
- API/Web 문서화 및 화면 설계
- backend 수직 slice 검증 (`auth/signup+login -> preferences -> trips -> itinerary -> waiting replan`)

### 막혀 있는 것

- Kakao OAuth 실서비스 env/callback end-to-end
- 이미지 업로드 기반 preference analyzer 품질 검증
- 모바일 WebView + 푸시 + 위치 연동 검증
- 분리 배포된 worker / WebSocket 클라이언트 기준 실시간 재계획 end-to-end

## 7. 다음 작업 권장 순서

1. Web 1차 UX 구현에서 demo auth + stable DTO shape를 그대로 소비하도록 연결
2. Mobile에 `metro.config.js`, Babel/React Native 기본 구성 보강
3. Web typecheck 잔여 이슈 정리
4. 마지막에 Kakao OAuth / LLM / 외부 API env 연결

## 8. 현재 판단

과제용 MVP가 아니라 "지금 써도 되는 1차 제품"으로 가려면, 현재 develop은 backend demo slice까지는 복구됐다. 다음 주요 blocker는 mobile 스타트업 부재와 web/mobile 잔여 타입 안정성이며, Kakao OAuth/외부 API는 v1 후순위로 두는 편이 안전하다.
