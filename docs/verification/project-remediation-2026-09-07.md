**TriPick 보안·기능·성능 수정 및 검증 — 2026-09-07**

기준 브랜치: `develop` (`1bec04f`), 작업 브랜치: `fix/audit-security-reliability`.
[수정 전 감사](project-audit-2026-09-07.md)의 A01~A14를 대상으로 수정했다. 최초 감사 당시의 별도 웹 지연 로딩 커밋 `627cca5`는 이 PR에 포함하지 않는다.

**수정 결과**

| 항목 | 조치 |
| --- | --- |
| A01 비공개 사진 | 공개 취향 DTO에서 `photoKeys` 쓰기를 제거했다. 업로드·조회·서명·분석 큐·삭제·탈퇴 정리에 사용자별 키 경계를 적용하고, 기존 목록의 타인 키를 응답·처리 대상에서 제외한다. 새 객체 이름에는 UUID를 쓴다. |
| A02 SSRF | 사용자 링크를 서버에서 요청하거나 리다이렉트하지 않는다. 허용한 지도 호스트의 URL만 로컬 파싱한다. |
| A03 재계획 인가 | 큐 등록 서비스에서 여행 소유자를 검사한다. 참여자는 기존 제안 → 소유자 승인 경로를 사용한다. 일반/대체/이탈 재계획 엔드포인트를 모두 검사했다. |
| A04 세션 폐기 | access JWT에 refresh family의 `sid`를 넣고 HTTP·WebSocket에서 실제 세션과 사용자 존재를 검사한다. 로그아웃은 해당 family, 비밀번호 재설정·변경은 전체 세션을 폐기한다. 연결된 소켓도 폐기·만료 시 종료한다. |
| A05 카카오 연결 | 이메일 유효·인증 상태가 모두 true일 때만 이메일을 계정 매칭에 사용한다. 이미 다른 카카오 ID가 연결된 계정의 덮어쓰기를 막는다. |
| A06 업로드 | Multer 수신 단계에 10MiB/파일, 파일·part·field 수 제한을 적용했다. 11MiB 실제 multipart 요청은 413이다. |
| A07 일정 보존 | 전체 일정 삭제·재삽입을 하나의 DB 트랜잭션으로 묶었다. 실패하는 INSERT를 주입한 뒤에도 기존 일정이 남는다. |
| A08 런타임 | `.nvmrc`, engines, Docker, CI를 Node 24 기준으로 맞췄다. Docker 설치 단계에서 로컬 의존성 패치도 복사한다. |
| A09 멤버 상태 | 계정이 연결된 멤버/owner의 상태를 일반 수정 API로 바꾸지 못하게 했다. 초대 거절·참여 종료 시 기존 여행 소켓 구독을 회수한다. |
| A10 웹 갱신 | refresh 토큰 없음·네이티브 브리지 실패에도 진행 중 Promise를 해제한다. 일시적 네트워크/5xx에는 세션을 유지하고, 재시도 시 명시적으로 전달된 오래된 Authorization도 교체한다. |
| A11 일정 입력 | 실제 HH:mm 범위, 여행 기간 내 일차, 중복 없는 전체 ID 순열을 검증한다. |
| A12 임베딩 | 차원 불일치·비유한 값·영벡터는 원격 정상 벡터로 취급하지 않는다. hash 폴백을 취향/장소 벡터에 저장하거나 벡터 검색에 섞지 않고 마지막 정상 취향 벡터를 보존한다. |
| A13 목록 조회 | 멤버와 일정 집계를 일괄 조회한다. 11개 여행에서 SELECT 최대 5회, 쓰기 0회를 회귀 검증했다. owner 행이 없는 기존 여행도 쓰기 없이 owner를 표시한다. 조회용 인덱스 4개를 추가했다. |
| A14 의존성 | 호환되는 패치 버전으로 갱신해 audit 공지 19건을 2건으로 줄였다. 공식 수정판이 없는 image-size의 나머지 2건은 로컬 패치와 회귀 검사로 완화했다. |

브라우저 E2E가 추가로 발견한 기본 취향 여행 생성 503도 수정했다. 방문이 폐장 시간을 넘기는 후보를 제외하고 마지막으로 담은 장소에서 다음 동선을 계산한다. 여러 폐장 장소를 건너뛰어도 순서 번호·이동 시간을 보존하며, 모든 후보가 불가능하면 빈 일정으로 기존 일정을 교체하지 않는다. 유효한 부분 일정은 기존 짧은 일정 허용 정책에 따라 저장한다.

`infra/runpod/start.sh`는 공개 리스너 기동 전에 `LLAMA_API_KEY`를 필수로 확인한다. Turbo 빌드 환경에 API/스토리지 origin을 선언해 Next rewrite 설정과 캐시가 일치하게 했다.

**검증**

최종 실행 환경은 macOS, Node 24.20.0, pnpm 9.12.0, PostgreSQL 16(pgvector), Redis 7이다. 테스트 DB 이름은 `_test`로 끝나야 하며, 통합 테스트는 별도의 `TEST_REDIS_URL`을 필수로 받는다. 개발 데이터에는 테스트 스키마 삭제를 실행하지 않는다. 단위·의존성·API E2E·통합·브라우저 테스트 합계는 1,117개 성공이다.

| 검사 | 결과 |
| --- | --- |
| `pnpm turbo run lint typecheck test --force` | 15개 작업 성공, 캐시 우회 |
| API 단위 테스트 | 73개 스위트, 937개 성공 |
| 공통 유틸 테스트 | 7개 스위트, 69개 성공 |
| 웹 세션 회귀 테스트 | 6개 성공 |
| 악성 이미지 의존성 회귀 테스트 | ICNS/JXL/HEIF 시간 제한 검사와 정상 PNG, 4개 성공 |
| API E2E 전체 | 7개 스위트, 94개 성공 (실제 JWT 보안 회귀 13개 포함) |
| 실제 큐 통합 테스트 | 1개 성공 |
| Playwright 전체 | Chromium·Firefox·WebKit(iPhone 13 viewport), 6개 성공, retries=0 |
| 전체 production 빌드 | API·웹·공통 패키지 4개 빌드 성공 |
| ESLint | 오류 0개, 기존 경고 포함 API 264개·웹 2개 |
| DB 마이그레이션 | 빈 DB 전체 16개 up, 반복 실행 0개, 최신 down → up 성공 |
| Node 24 Docker | 최종 이미지 빌드·UID 1000 기동·`/api/v1/health` 200 확인 |
| `git diff --check` | 통과 |

API 보안 E2E는 실제 JWT/인가와 PostgreSQL을 사용해 타인 사진 키, SSRF 요청 미발생, 비소유자 재계획, 대용량 업로드, 잘못된 일정 입력, 트랜잭션 롤백, 목록 쿼리 수, 멤버 소켓 회수, refresh 회전 후 로그아웃, 비밀번호 재설정·탈퇴 후 HTTP·WebSocket 차단을 검사한다. 탈퇴는 TypeORM이 삭제 후 엔티티 ID를 비우므로 삭제 전에 ID를 보존해 폐기 이벤트를 전달한다. 통합 테스트는 실제 BullMQ 작업 실행 → 일정 교체 → Socket.IO 전달 → DB 저장 일치를 검사한다.

브라우저 테스트는 실제 production Next 서버와 Nest 서버를 연결한다. UI 가입·메일 링크 인증·로그인·취향 설정 건너뛰기 후 여행을 API로 생성하고, UI 일정 메모 편집·새로고침 후 보존·실제 401에서 refresh 회복·로그아웃 후 토큰 차단·익명 보호 경로를 검사한다. 화면의 데스크톱/모바일 숨김 복제 요소 대신 접근성 역할로 현재 표시되는 메모를 검증한다.

메일 발송과 S3는 로컬 테스트 대체 객체, 임베딩은 로컬 HTTP fixture, AI 계획은 결정적 폴백이다. 외부 LLM·카카오 OAuth/지도·FCM·실제 메일/R2 통합이나 네이티브 iOS/Android 실기기 E2E를 검증한 결과가 아니다. 현재 저장소에 구성된 API E2E·큐 통합·추가한 브라우저 E2E 전체를 실행했다.

**재실행 방법**

Node 24와 pnpm 9.12.0, 로컬 PostgreSQL(pgvector), 테스트 전용 Redis가 필요하다. 아래 DB는 테스트 중 스키마가 삭제되므로 테스트용으로만 사용한다.

```sh
pnpm install --frozen-lockfile
pnpm turbo run lint typecheck test --force
pnpm test:security-deps
TEST_DATABASE_URL=postgresql://tripick:tripick@localhost:5432/tripick_regression_test TEST_REDIS_URL=redis://127.0.0.1:6387 pnpm --filter @tripick/api test:e2e
TEST_DATABASE_URL=postgresql://tripick:tripick@localhost:5432/tripick_integration_test TEST_REDIS_URL=redis://127.0.0.1:6387 pnpm --filter @tripick/api test:integration
TRIPICK_API_ORIGIN=http://127.0.0.1:4310 pnpm turbo run build --filter=@tripick/web
pnpm --filter @tripick/web exec playwright install chromium firefox webkit
TEST_DATABASE_URL=postgresql://tripick:tripick@localhost:5432/tripick_browser_test TEST_REDIS_URL=redis://127.0.0.1:6388 pnpm --filter @tripick/web test:e2e
```

Linux에서는 Playwright 설치에 `--with-deps`를 추가한다. CI에도 동일한 API·큐·세 브라우저 테스트와 마이그레이션 검증을 구성했다. 브라우저 실패 시 trace/screenshot, 실행 후 HTML 보고서를 생성한다.

**배포 시 달라지는 동작과 남은 과제**

- 기존 `sid` 없는 access JWT는 401이 된다. 유효한 기존 refresh family가 있으면 클라이언트 갱신으로 새 JWT를 받고, 없으면 재로그인이 필요하다.
- 해석할 수 없는 단축 지도 링크는 장소 이름이나 확장된 검색 URL로 입력해야 한다. 서버가 사용자 URL을 열지 않는 정책의 결과다.
- 공개 취향 API로 `photoKeys`를 직접 설정하면 400이다. 앱의 정상 사진 업로드 경로를 사용한다. 기존 오염 키를 DB에서 일괄 정리하는 데이터 마이그레이션은 포함하지 않는다.
- 인덱스 생성은 일반 트랜잭션 마이그레이션이다. 대규모 운영 테이블에서는 잠금 시간을 고려해 적용해야 한다.
- WebSocket 즉시 폐기 알림은 현재 단일 API 프로세스 구성에 맞춘 메모리 이벤트다. 복제본을 늘릴 때는 Redis 등으로 폐기 이벤트를 전파해야 한다. HTTP는 각 요청에서 DB를 검사한다.
- image-size audit High 2건은 버전 기반 검사에 계속 표시된다. [ICNS 공지](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr)와 [JXL/HEIF 공지](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq)에 공식 수정판이 없으므로 `patches/image-size@1.2.1.patch`를 적용했다. 악성 길이가 파서를 진행하지 못하게 하는 루프를 차단하며, 정상 파일 회귀도 검사한다. 주 노출 경로는 React Native Metro의 빌드 입력이다.
- 별도 후속 과제: 동시 사진 업로드의 원자적 목록 갱신/실패 보상, 전역 큐 스캔 제거와 원자적 중복 방지, 목록 페이지네이션, 여러 탭의 refresh 조율, HttpOnly refresh/CSP 설계, 임베딩 모델 버전 관리, 운영 IAM·백업 복구·실제 공급자/네이티브 검증. 카카오 이메일 매칭도 장기적으로 명시적 계정 연결·재인증 흐름으로 전환할 여지가 있다.
